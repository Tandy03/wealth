// Canonical portfolio document shared by the web UI, Android and JSON repository.
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FinoStateModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const collections = ['assets', 'transactions', 'payments', 'calendarNotes', 'sales', 'priceHistory', 'instruments'];
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const schemaVersion = 1;
  // Optional fields retain compatibility with sparse historical documents.
  const entityFields = {
    Asset: { strings: ['id', 'name', 'type', 'currency'], numbers: ['quantity', 'purchasePrice', 'currentPrice'], dates: ['purchaseDate', 'maturityDate'] },
    Transaction: { strings: ['id', 'assetId', 'type', 'currency'], numbers: ['quantity', 'amount', 'costBasis'], dates: ['date'] },
    Sale: { strings: ['id', 'assetId', 'type', 'currency'], numbers: ['quantity', 'sellPrice', 'purchasePrice', 'saleProceeds', 'profit', 'costBasis', 'roi'], dates: ['sellDate'] },
    Payment: { strings: ['id', 'assetId', 'type', 'currency', 'status'], numbers: ['amount'], dates: ['date', 'receivedDate'] },
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
    if (!isRecord(value)) throw new Error(location + ' must be an object.');
    const fields = entityFields[type];
    if (!fields) throw new Error('Unknown entity type: ' + type);
    if (type === 'Wallet') {
      for (const key of ['expenses', 'loans']) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !isRecord(item)))) throw new Error('Invalid wallet ' + key + '.');
      if (value.months !== undefined && !isRecord(value.months)) throw new Error('Invalid wallet months.');
      for (const month of Object.values(value.months || {})) if (!isRecord(month)) throw new Error('Invalid wallet month.');
    }
    for (const key of fields.strings) if (value[key] != null && typeof value[key] !== 'string') throw new Error(location + '.' + key + ' must be a string.');
    for (const key of fields.numbers) if (value[key] != null && (value[key] === '' || !['number', 'string'].includes(typeof value[key]) || !Number.isFinite(Number(value[key])))) throw new Error(location + '.' + key + ' must contain finite numbers.');
    for (const key of fields.dates) if (value[key] != null && value[key] !== '' && !isDate(value[key])) throw new Error(location + '.' + key + ' must be a valid YYYY-MM-DD date.');
    return value;
  }
  const migrations = [function migrateLegacy(state) { state.schemaVersion = 1; return state; }];
  function createEmptyState() {
    return { schemaVersion, assets: [], transactions: [], payments: [], calendarNotes: [], sales: [], priceHistory: [],
      instruments: [], wallet: { expenses: [], months: {}, loans: [] } };
  }
  function validateJson(value, location = 'state', ancestors = new Set()) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(location + ' must contain finite numbers.');
    if (['function', 'symbol', 'bigint'].includes(typeof value)) throw new Error(location + ' must be JSON-compatible.');
    if (value && typeof value === 'object') {
      if (ancestors.has(value)) throw new Error(location + ' contains a circular reference.');
      ancestors.add(value);
      for (const [key, item] of Object.entries(value)) validateJson(item, location + '.' + key, ancestors);
      ancestors.delete(value);
    }
  }
  function validateState(value) {
    if (!isRecord(value) || !Array.isArray(value.assets)) throw new Error('Portfolio must contain an assets collection.');
    if (value.schemaVersion !== undefined && (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 0 || value.schemaVersion > schemaVersion)) throw new Error('Unsupported schemaVersion.');
    for (const key of collections) {
      if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !isRecord(item)))) throw new Error('Invalid portfolio ' + key + ' collection.');
    }
    for (const [key, type] of Object.entries({ assets: 'Asset', transactions: 'Transaction', sales: 'Sale', payments: 'Payment', calendarNotes: 'CalendarNote', instruments: 'Instrument' })) {
      for (const [index, item] of (value[key] || []).entries()) validateEntity(type, item, key + '[' + index + ']');
    }
    if (value.wallet !== undefined) validateEntity('Wallet', value.wallet, 'wallet');
    if (value.sync !== undefined && (!isRecord(value.sync) || (value.sync.revision !== undefined && (!Number.isFinite(Number(value.sync.revision)) || Number(value.sync.revision) < 0)))) throw new Error('Invalid sync metadata.');
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
  return { schemaVersion, entityFields, migrations, createEmptyState, normalizeState, validateState, validateEntity, buildIndexes,
    read: normalizeState, write: normalizeState };
});
