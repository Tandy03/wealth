// Persisted command receipts. No I/O, DOM or application dependencies.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./errors') : root.FinoErrors,
    () => typeof module === 'object' && module.exports ? require('./validation').createDefault() : root.FinoValidation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (errors, getRules) {
  const kinds = ['createAsset', 'buyMoreAsset', 'createSale', 'createTransaction', 'createPayment', 'createCalendarNote', 'mergeAssets', 'markPaymentReceived'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const REPLAY_DAYS = 30;
  // Synchronous SHA-256 keeps the existing serialized Node/native command path.
  // Input is canonical JSON (including escaped lone UTF-16 surrogates).
  function sha256(text) {
    const encoded = encodeURIComponent(text), bytes = [];
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === '%') { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
      else bytes.push(encoded.charCodeAt(i));
    }
    const length = bytes.length * 8;
    bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(Math.floor(length / 2 ** (i * 8)) & 255);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const rotate = (n, bits) => n >>> bits | n << (32 - bits);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const w = Array(64);
      for (let i = 0; i < 16; i++) w[i] = bytes[offset+i*4]<<24 | bytes[offset+i*4+1]<<16 | bytes[offset+i*4+2]<<8 | bytes[offset+i*4+3];
      for (let i = 16; i < 64; i++) {
        const a = w[i-15], b = w[i-2];
        w[i] = (w[i-16] + (rotate(a,7)^rotate(a,18)^a>>>3) + w[i-7] + (rotate(b,17)^rotate(b,19)^b>>>10)) | 0;
      }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) {
        const t = (j + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + (e&f^~e&g) + k[i] + w[i]) | 0;
        const u = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + (a&b^a&c^b&c)) | 0;
        j=g; g=f; f=e; e=(d+t)|0; d=c; c=b; b=a; a=(t+u)|0;
      }
      [a,b,c,d,e,f,g,j].forEach((value, i) => { h[i] = (h[i]+value)|0; });
    }
    return h.map(n => (n>>>0).toString(16).padStart(8,'0')).join('');
  }
  function receiptCurrency(entry) {
    return ['buyMoreAsset', 'createSale', 'createTransaction', 'createPayment'].includes(entry.kind)
      ? entry.result.currency || entry.result.asset?.currency || entry.result.sale?.currency || entry.result.sales?.[0]?.currency : undefined;
  }
  function fingerprint(descriptor, defaultCurrency) {
    const command = { ...descriptor.command };
    if (defaultCurrency) command.currency ||= defaultCurrency;
    return sha256(canonical([descriptor.kind, descriptor.target, command]));
  }
  function compact(data, now = Date.now()) {
    const cutoff = new Date(now); cutoff.setUTCDate(cutoff.getUTCDate() - REPLAY_DAYS);
    let count = 0;
    for (let i = 0; i < (data.operations || []).length; i++) {
      const entry = data.operations[i];
      if (entry.expired || Date.parse(entry.createdAt) > cutoff.getTime()) continue;
      const defaultCurrency = receiptCurrency(entry);
      data.operations[i] = { operationId: entry.operationId, fingerprint: fingerprint(entry, defaultCurrency), createdAt: entry.createdAt,
        expired: true, ...(defaultCurrency ? { defaultCurrency } : {}) };
      count++;
    }
    return count;
  }
  function validateId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new errors.ValidationError({ message: 'operationId must be a nonempty identifier of at most 128 characters.' });
  }
  function canonical(value) {
    return JSON.stringify((function sort(item) {
      if (Array.isArray(item)) return item.map(sort);
      return item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, sort(item[key])])) : item;
    })(value));
  }
  let requests;
  function describe(method, args) {
    const kind = ({ sellAsset: 'createSale', createNote: 'createCalendarNote' })[method] || method;
    if (!kinds.includes(kind)) return null;
    const targeted = ['buyMoreAsset', 'markPaymentReceived'].includes(kind);
    const body = kind === 'mergeAssets' ? { ...args[1], assetIds: args[0] } : args[targeted ? 1 : 0] || {};
    const descriptor = { kind, target: targeted ? args[0] : null, operationId: body.operationId };
    if (body.operationId === undefined) return descriptor;
    validateId(body.operationId);
    requests ||= getRules();
    let command;
    if (kind === 'createAsset') {
      command = requests.assetInput(body); delete command.operationId;
      command.dividendRecordRule ||= 'previous_month_end';
      command.instrumentName ||= ''; command.instrumentType ||= ''; command.isNewInstrument = Boolean(command.isNewInstrument);
      if (command.ticker) command.ticker = command.ticker.toUpperCase();
      if (command.coupons) command.coupons.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      const requestKind = ({ buyMoreAsset: 'buy', createSale: 'sale', createTransaction: 'transaction', createPayment: 'payment', createCalendarNote: 'note', mergeAssets: 'merge' })[kind];
      const input = kind === 'buyMoreAsset' ? requests.normalizePurchase(body) : body;
      if (requestKind) requests.validateRequest(requestKind, input);
      const fields = {
        buyMoreAsset: ['quantity', 'purchasePrice', 'purchaseDate', 'currency', 'instrumentId'],
        createSale: ['quantity', 'sellPrice', 'sellDate', 'currency'],
        createTransaction: ['assetId', 'type', 'date', 'amount', 'quantity', 'purchasePrice', 'currency', 'instrumentId', 'paymentId'],
        createPayment: ['assetId', 'type', 'date', 'amount', 'amountPerUnit', 'currency', 'recordDate'],
        createCalendarNote: ['assetId', 'date', 'text', 'amount'], mergeAssets: ['assetIds'], markPaymentReceived: [],
      }[kind];
      command = Object.fromEntries(fields.filter(key => input[key] != null).map(key => [key, input[key]]));
      for (const key of ['quantity', 'purchasePrice', 'sellPrice', 'amount', 'amountPerUnit']) if (command[key] !== undefined) command[key] = Number(command[key]);
      if (command.currency) command.currency = command.currency.trim().toUpperCase();
      if (command.text) command.text = command.text.trim();
      if (kind === 'createCalendarNote') command.amount ||= 0;
      if (kind === 'createSale') command.assetIds = [...new Set(body.assetIds?.length ? body.assetIds : [body.assetId])].sort();
      if (kind === 'mergeAssets') command.assetIds = [...new Set(command.assetIds)].sort();
    }
    descriptor.command = command;
    return descriptor;
  }
  function conflict(code = 'OPERATION_ID_CONFLICT') { return new errors.ConflictError({ code, message: 'This operationId was already used for a different command. Keep the original command or start a new operation.' }); }
  function begin(data, descriptor) {
    if (!descriptor?.operationId) return null;
    const previous = data.operations?.find(entry => entry.operationId === descriptor.operationId);
    if (previous) {
      if (previous.expired) {
        if (previous.fingerprint !== fingerprint(descriptor, previous.defaultCurrency)) throw conflict();
        throw new errors.ConflictError({ code: 'OPERATION_RESULT_EXPIRED', message: 'This command was already recorded, but its replay result has expired. Reload the portfolio; do not submit it as a new command.' });
      }
      const comparable = command => {
        const result = { ...command };
        if (['buyMoreAsset', 'createSale', 'createTransaction', 'createPayment'].includes(previous.kind)) {
          const currency = previous.result.currency || previous.result.asset?.currency || previous.result.sale?.currency || previous.result.sales?.[0]?.currency;
          result.currency ||= currency;
        }
        return result;
      };
      if (canonical([previous.kind, previous.target, comparable(previous.command)]) !== canonical([descriptor.kind, descriptor.target, comparable(descriptor.command)])) throw conflict();
      return { replayed: true, result: clone(previous.result) };
    }
    // A damaged/imported document with a fact but no receipt must not duplicate it.
    if (['assets', 'transactions', 'sales', 'payments', 'calendarNotes'].some(key => (data[key] || []).some(item => item.operationId === descriptor.operationId || item.receivedOperationId === descriptor.operationId))) throw conflict('OPERATION_RECEIPT_MISSING');
    return { descriptor };
  }
  function remember(data, receipt, result) {
    if (!receipt?.descriptor) return;
    const { descriptor } = receipt, key = descriptor.operationId;
    const tag = record => { if (record) record.operationId ||= key; };
    switch (descriptor.kind) {
      case 'createAsset': tag(result); tag(data.transactions.find(tx => tx.assetId === result.id && tx.type === 'BUY')); break;
      case 'buyMoreAsset': tag(result.transaction); break;
      case 'createSale': for (const record of [...(result.sales || [result.sale]), ...(result.transactions || [result.transaction])]) tag(record); break;
      case 'createTransaction': tag(result); if (result.saleId) tag(data.sales.find(sale => sale.id === result.saleId)); break;
      case 'createPayment': case 'createCalendarNote': tag(result); break;
      case 'markPaymentReceived': result.receivedOperationId ||= key; tag(data.transactions.find(tx => tx.paymentId === result.id)); break;
    }
    (data.operations ||= []).push({ ...clone(descriptor), createdAt: new Date().toISOString(), result: clone(result) });
  }
  function validateLog(entries, validateEntity) {
    if (!Array.isArray(entries)) throw new errors.ValidationError({ message: 'Invalid operation receipts.' });
    const ids = new Set();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') throw new errors.ValidationError({ message: 'Invalid operation receipt.' });
      validateId(entry.operationId);
      if (entry.expired !== undefined) {
        if (entry.expired !== true || ids.has(entry.operationId) || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
            typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) ||
            entry.defaultCurrency !== undefined && (typeof entry.defaultCurrency !== 'string' || !/^[A-Z]{3}$/.test(entry.defaultCurrency)) ||
            Object.keys(entry).some(key => !['operationId', 'fingerprint', 'createdAt', 'expired', 'defaultCurrency'].includes(key))) throw new errors.ValidationError({ message: 'Invalid compacted operation receipt.' });
        ids.add(entry.operationId); continue;
      }
      if (ids.has(entry.operationId) || !kinds.includes(entry.kind) || !(entry.target === null || typeof entry.target === 'string') || !entry.command || typeof entry.command !== 'object' || Array.isArray(entry.command) || !entry.result || typeof entry.result !== 'object' || Array.isArray(entry.result) || typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt))) throw new errors.ValidationError({ message: 'Invalid or duplicate operation receipt.' });
      ids.add(entry.operationId);
      if (validateEntity) {
        const result = entry.result;
        const entities = ({ createAsset: [['Asset', result]], mergeAssets: [['Asset', result]],
          buyMoreAsset: [['Asset', result.asset], ['Transaction', result.transaction]],
          createTransaction: [['Transaction', result]], createPayment: [['Payment', result]], markPaymentReceived: [['Payment', result]],
          createCalendarNote: [['CalendarNote', result]] })[entry.kind] || [];
        if (entry.kind === 'createSale') {
          if (result.sales !== undefined && !Array.isArray(result.sales) || result.transactions !== undefined && !Array.isArray(result.transactions) || typeof result.remainingQuantity !== 'number' || !Number.isFinite(result.remainingQuantity) || result.remainingQuantity < 0) throw new errors.ValidationError({ message: 'Invalid sale receipt.' });
          entities.push(...(result.sales || [result.sale]).map(item => ['Sale', item]), ...(result.transactions || [result.transaction]).map(item => ['Transaction', item]));
        }
        for (const [type, entity] of entities) {
          if (typeof entity?.id !== 'string' || !entity.id.trim()) throw new errors.ValidationError({ message: 'Operation results require record identifiers.' });
          validateEntity(type, entity, 'operation.result');
        }
      }
    }
  }
  function newId() {
    const crypto = typeof module === 'object' && module.exports ? require('node:crypto') : globalThis.crypto;
    if (crypto?.randomUUID) return crypto.randomUUID();
    if (!crypto?.getRandomValues) throw new errors.ValidationError({ message: 'Secure operation IDs are unavailable.' });
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
  }
  function client(service, getScope = () => null) {
    const pending = new WeakMap();
    return Object.fromEntries(Object.entries(service).map(([method, invoke]) => [method, !kinds.includes(method) ? invoke : async (...args) => {
      const targeted = ['buyMoreAsset', 'markPaymentReceived', 'mergeAssets'].includes(method), index = targeted ? 1 : 0;
      const original = args[index], body = original || {};
      const scope = getScope();
      if (body.operationId === undefined) {
        const signature = canonical([method, targeted ? args[0] : null, body]);
        const previous = original && typeof original === 'object' ? pending.get(original) : null;
        const key = previous?.signature === signature && previous.scope === scope ? previous.id : newId();
        if (original && typeof original === 'object') pending.set(original, { signature, scope, id: key });
        args[index] = { ...body, operationId: key };
      }
      const result = await invoke(...args);
      if (original && typeof original === 'object') pending.delete(original);
      return result;
    }]));
  }
  return { kinds, validateId, canonical, describe, begin, remember, validateLog, newId, client, fingerprint, compact, REPLAY_DAYS };
});
