// Canonical portfolio document shared by the web UI, Android and JSON repository.
(function (root, factory) {
  const model = factory(typeof module === 'object' && module.exports ? require('./state-contract') : root.FinoStateContract, typeof module === 'object' && module.exports ? require('./errors') : root.FinoErrors);
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FinoStateModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (contract, errors) {
  const collections = ['assets', 'transactions', 'payments', 'calendarNotes', 'sales', 'priceHistory', 'instruments'];
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const schemaVersion = 1;
  // Optional fields retain compatibility with sparse historical documents.
  const entityFields = {
    Asset: { strings: ['id', 'name', 'type', 'currency', 'ticker', 'symbol', 'isin', 'dividendRecordRule'], numbers: ['quantity', 'purchasePrice', 'currentPrice', 'remainingQuantity', 'remainingCostBasis', 'legacyPurchaseCost', 'annualRate', 'maturityAmount', 'maturityAmountPerUnit', 'redemptionValue', 'dividendPerUnit', 'termMonths'], dates: ['purchaseDate', 'maturityDate', 'firstDividendDate'] },
    Transaction: { strings: ['id', 'assetId', 'type', 'currency', 'status', 'costBasisMethod'], numbers: ['quantity', 'amount', 'costBasis', 'purchasePrice', 'price', 'sellPrice', 'saleProceeds', 'profit', 'roi'], dates: ['date'] },
    Sale: { strings: ['id', 'assetId', 'type', 'currency'], numbers: ['quantity', 'sellPrice', 'purchasePrice', 'saleProceeds', 'profit', 'costBasis', 'roi'], dates: ['sellDate'] },
    Payment: { strings: ['id', 'assetId', 'type', 'currency', 'status'], numbers: ['amount', 'amountPerUnit', 'costBasis'], dates: ['date', 'receivedDate', 'recordDate'] },
    CalendarNote: { strings: ['id', 'title', 'currency'], numbers: ['amount'], dates: ['date'] },
    Instrument: { strings: ['id', 'name', 'type', 'symbol', 'currency'], numbers: [], dates: [] },
    Wallet: { strings: [], numbers: [], dates: [] },
  };
  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validateEntity(type, value, location = type) {
    if (!isRecord(value)) throw new errors.ValidationError({ message: location + ' must be an object.' });
    const fields = entityFields[type];
    if (!fields) throw new errors.ValidationError({ message: 'Unknown entity type: ' + type });
    if (type === 'Wallet') {
      for (const key of ['expenses', 'loans']) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !isRecord(item)))) throw new errors.ValidationError({ message: 'Invalid wallet ' + key + '.' });
      if (value.months !== undefined && !isRecord(value.months)) throw new errors.ValidationError({ message: 'Invalid wallet months.' });
      for (const month of Object.values(value.months || {})) if (!isRecord(month)) throw new errors.ValidationError({ message: 'Invalid wallet month.' });
      const finiteNonnegative = number => ['number', 'string'].includes(typeof number) && number !== '' && (typeof number !== 'string' || number.trim()) && Number.isFinite(Number(number)) && Number(number) >= 0;
      for (const expense of value.expenses || []) if (!isDate(expense.date) || typeof expense.category !== 'string' || !expense.category.trim() || !finiteNonnegative(expense.amount) || Number(expense.amount) <= 0 || expense.note != null && typeof expense.note !== 'string') throw new errors.ValidationError({ message: 'Invalid wallet expense.' });
      for (const [key, month] of Object.entries(value.months || {})) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new errors.ValidationError({ message: 'Invalid wallet month key.' });
        if (month.plans != null && (!isRecord(month.plans) || Object.values(month.plans).some(amount => !finiteNonnegative(amount)))) throw new errors.ValidationError({ message: 'Invalid wallet planned amount.' });
        if (month.customCategories != null && (!Array.isArray(month.customCategories) || month.customCategories.some(category => typeof category !== 'string'))) throw new errors.ValidationError({ message: 'Invalid wallet category.' });
        if (month.notes != null && (!Array.isArray(month.notes) || month.notes.some(note => !isRecord(note) || typeof note.text !== 'string'))) throw new errors.ValidationError({ message: 'Invalid wallet note.' });
      }
      for (const loan of value.loans || []) {
        for (const field of ['amount', 'balance', 'monthlyPayment', 'paymentDay']) if (loan[field] != null && !finiteNonnegative(loan[field])) throw new errors.ValidationError({ message: 'Invalid wallet loan amount.' });
        for (const field of ['dueDate', 'lastPaymentDate']) if (loan[field] && !isDate(loan[field])) throw new errors.ValidationError({ message: 'Invalid wallet loan date.' });
        for (const key of ['manualSchedule', 'repayments']) if (loan[key] != null && (!Array.isArray(loan[key]) || loan[key].some(payment => !isRecord(payment) || !isDate(payment.date) || !finiteNonnegative(payment.amount)))) throw new errors.ValidationError({ message: 'Invalid wallet loan schedule.' });
      }
    }
    for (const key of fields.strings) if (value[key] != null && typeof value[key] !== 'string') throw new errors.ValidationError({ message: location + '.' + key + ' must be a string.' });
    for (const key of fields.numbers) if (value[key] != null && (value[key] === '' || !['number', 'string'].includes(typeof value[key]) || !Number.isFinite(Number(value[key])))) throw new errors.ValidationError({ message: location + '.' + key + ' must contain finite numbers.' });
    for (const key of fields.dates) if (value[key] != null && value[key] !== '' && !isDate(value[key])) throw new errors.ValidationError({ message: location + '.' + key + ' must be a valid YYYY-MM-DD date.' });
    const vocabulary = ['Asset', 'Sale'].includes(type) ? contract.assetTypes : type === 'Payment' ? contract.paymentTypes : type === 'Transaction' ? contract.transactionTypes : null;
    const kind = ['Asset', 'Sale'].includes(type) ? String(value.type || '').trim().toLowerCase() : String(value.type || '').trim().toUpperCase();
    if (vocabulary && value.type != null && !vocabulary.includes(kind)) throw new errors.ValidationError({ message: location + '.type is unsupported.' });
    if (value.currency != null && !['UAH', 'USD', 'EUR'].includes(value.currency.trim().toUpperCase())) throw new errors.ValidationError({ message: location + '.currency is unsupported.' });
    if (type === 'Payment' && value.status != null && !['planned', 'received', 'paid'].includes(value.status)) throw new errors.ValidationError({ message: location + '.status is unsupported.' });
    if (type === 'Transaction' && value.status != null && !['planned', 'pending', 'cancelled', 'completed', 'posted'].includes(value.status)) throw new errors.ValidationError({ message: location + '.status is unsupported.' });
    if (['Asset', 'Payment', 'Transaction', 'Sale'].includes(type)) for (const key of fields.numbers) if (!['profit', 'roi'].includes(key) && value[key] != null && Number(value[key]) < 0) throw new errors.ValidationError({ message: location + '.' + key + ' must be nonnegative.' });
    if (value.annualRate != null && Number(value.annualRate) > 1000) throw new errors.ValidationError({ message: location + '.annualRate exceeds the supported range.' });
    if (value.purchaseDate && value.maturityDate && value.maturityDate < value.purchaseDate) throw new errors.ValidationError({ message: location + '.maturityDate must follow purchaseDate.' });
    if (value.recordDate && (!value.date || value.recordDate > value.date || value.type !== 'DIVIDEND')) throw new errors.ValidationError({ message: location + '.recordDate must precede its dividend payment date.' });
    if (type === 'Asset' && value.dividendRecordRule != null && !['payment_date', 'previous_month_end'].includes(value.dividendRecordRule)) throw new errors.ValidationError({ message: location + '.dividendRecordRule is unsupported.' });
    if (type === 'Asset' && value.coupons != null) {
      if (!Array.isArray(value.coupons)) throw new errors.ValidationError({ message: location + '.coupons must be an array.' });
      for (const coupon of value.coupons) if (!isRecord(coupon) || !isDate(coupon.date) || !['number', 'string'].includes(typeof coupon.amountPerUnit) || coupon.amountPerUnit === '' || !Number.isFinite(Number(coupon.amountPerUnit)) || Number(coupon.amountPerUnit) < 0 || value.purchaseDate && coupon.date < value.purchaseDate || value.maturityDate && coupon.date > value.maturityDate) throw new errors.ValidationError({ message: location + '.coupons contains invalid financial data.' });
    }
    for (const field of ['closedAt', 'receivedAt']) if (value[field] != null && !isDate(value[field]) && (!/^\d{4}-\d{2}-\d{2}T/.test(value[field]) || !isDate(value[field].slice(0, 10)) || !Number.isFinite(Date.parse(value[field])))) throw new errors.ValidationError({ message: location + '.' + field + ' must be a calendar date or ISO timestamp.' });
    return value;
  }
  const migrations = [function migrateLegacy(state) { state.schemaVersion = 1; return state; }];
  function createEmptyState() {
    return { schemaVersion, assets: [], transactions: [], payments: [], calendarNotes: [], sales: [], priceHistory: [],
      instruments: [], wallet: { expenses: [], months: {}, loans: [] } };
  }
  function validateJson(value, location = 'state', ancestors = new Set()) {
    if (ancestors.size > 64) throw new errors.ValidationError({ message: 'JSON nesting exceeds the supported depth.' });
    if (typeof value === 'number' && !Number.isFinite(value)) throw new errors.ValidationError({ message: location + ' must contain finite numbers.' });
    if (['function', 'symbol', 'bigint'].includes(typeof value)) throw new errors.ValidationError({ message: location + ' must be JSON-compatible.' });
    if (value && typeof value === 'object') {
      if (ancestors.has(value)) throw new errors.ValidationError({ message: location + ' contains a circular reference.' });
      ancestors.add(value);
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new errors.ValidationError({ message: 'Unsafe JSON property.' });
        if (typeof item === 'string' && item.length > 100000) throw new errors.ValidationError({ message: 'JSON string exceeds the supported size.' });
        validateJson(item, location + '.' + key, ancestors);
      }
      ancestors.delete(value);
    }
  }
  function validateState(value) {
    if (!isRecord(value) || !Array.isArray(value.assets)) throw new errors.ValidationError({ message: 'Portfolio must contain an assets collection.' });
    if (value.schemaVersion !== undefined && (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 0 || value.schemaVersion > schemaVersion)) throw new errors.ValidationError({ message: 'Unsupported schemaVersion.' });
    for (const key of collections) {
      if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !isRecord(item)))) throw new errors.ValidationError({ message: 'Invalid portfolio ' + key + ' collection.' });
    }
    for (const [key, type] of Object.entries({ assets: 'Asset', transactions: 'Transaction', sales: 'Sale', payments: 'Payment', calendarNotes: 'CalendarNote', instruments: 'Instrument' })) {
      const ids = new Set();
      for (const [index, item] of (value[key] || []).entries()) validateEntity(type, item, key + '[' + index + ']');
      for (const item of value[key] || []) if (item.id) { if (ids.has(item.id)) throw new errors.ValidationError({ message: 'Duplicate ' + key + ' identifier.' }); ids.add(item.id); }
    }
    if (value.wallet !== undefined) validateEntity('Wallet', value.wallet, 'wallet');
    if (value.rebalance !== undefined) validateRebalance(value.rebalance);
    if (value.sync !== undefined && (!isRecord(value.sync) || (value.sync.revision !== undefined && (!Number.isSafeInteger(Number(value.sync.revision)) || Number(value.sync.revision) < 0)))) throw new errors.ValidationError({ message: 'Invalid sync metadata.' });
    validateJson(value);
    return value;
  }
  function normalizeState(value) {
    validateState(value);
    const result = JSON.parse(JSON.stringify(value));
    let version = result.schemaVersion || 0;
    while (version < schemaVersion) { migrations[version](result); version = result.schemaVersion; }
    for (const key of collections) result[key] ||= [];
    for (const key of collections) for (const item of result[key]) {
      if (typeof item.currency === 'string') item.currency = item.currency.trim().toUpperCase();
      if (key === 'assets' && typeof item.type === 'string') item.type = item.type.trim().toLowerCase();
      if (key === 'transactions' && typeof item.type === 'string') item.type = item.type.trim().toUpperCase();
      const type = { assets: 'Asset', transactions: 'Transaction', sales: 'Sale', payments: 'Payment', calendarNotes: 'CalendarNote', instruments: 'Instrument' }[key];
      for (const field of entityFields[type]?.numbers || []) if (item[field] != null) item[field] = Number(item[field]);
    }
    result.wallet ||= {};
    result.wallet.expenses ||= [];
    result.wallet.months ||= {};
    result.wallet.loans ||= [];
    return result;
  }
  function buildIndexes(state) {
    return { assetsById: new Map(state.assets.map(asset => [asset.id, asset])), instrumentsById: new Map((state.instruments || []).map(item => [item.id, item])) };
  }
  // A draft may total less/more than 100%; calculation requires exactly 100%.
  function validateRebalance(plan) {
    const fail = () => { throw new errors.ValidationError({ message: 'Invalid rebalance plan.' }); };
    validateJson(plan);
    if (!isRecord(plan) || Object.keys(plan).some(key => !['targets', 'plannedAssets', 'excluded'].includes(key)) ||
        !isRecord(plan.targets) || !Array.isArray(plan.plannedAssets) || !Array.isArray(plan.excluded)) fail();
    const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 1000;
    if ([Object.keys(plan.targets), plan.plannedAssets, plan.excluded].some(items => items.length > 1000)) fail();
    for (const [id, share] of Object.entries(plan.targets)) if (!validId(id) || typeof share !== 'number' ||
        !Number.isFinite(share) || share < 0 || share > 100 || Math.abs(share * 10 - Math.round(share * 10)) > 1e-6) fail();
    const ids = new Set();
    for (const item of plan.plannedAssets) {
      if (!isRecord(item) || Object.keys(item).some(key => !['id', 'label'].includes(key)) || !validId(item.id) ||
          !item.id.startsWith('planned-') || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 500) fail();
      ids.add(item.id);
    }
    if (plan.excluded.some(id => !validId(id) || ids.has(id)) || new Set(plan.excluded).size !== plan.excluded.length) fail();
    return plan;
  }
  function rebalanceSignature(plan) {
    if (plan == null) return 'null';
    validateRebalance(plan);
    return JSON.stringify({ targets: Object.fromEntries(Object.entries(plan.targets).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
      plannedAssets: plan.plannedAssets.map(({ id, label }) => ({ id, label })), excluded: [...plan.excluded].sort() });
  }
  function applyRebalance(state, request) {
    validateJson(request);
    if (!isRecord(request) || !Object.hasOwn(request, 'expected') || Object.keys(request).some(key => !['plan', 'expected'].includes(key)))
      throw new errors.ValidationError({ message: 'Invalid rebalance plan.' });
    validateRebalance(request.plan);
    if (rebalanceSignature(state.rebalance) !== rebalanceSignature(request.expected))
      throw new errors.ConflictError({ message: 'The rebalance plan changed. Reload before editing it again.' });
    state.rebalance = JSON.parse(JSON.stringify(request.plan));
    return state.rebalance;
  }
  return { schemaVersion, entityFields, migrations, createEmptyState, normalizeState, validateState, validateEntity, buildIndexes,
    validateRebalance, rebalanceSignature, applyRebalance, validateJson, isDate, ...contract, read: normalizeState, write: normalizeState };
});
