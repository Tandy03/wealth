// One set of raw-input rules for HTTP domain services and native local operations.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory;
    module.exports.createDefault = () => {
      const errors = require('./errors');
      class RawError extends errors.ValidationError { constructor(payload, status = 400) { super({ message: payload.error, status }); } }
      return factory({ DomainError: RawError, isValidDateString: require('./state-model').isDate, constants: require('./constants') });
    };
  }
  else {
    class ValidationError extends root.FinoErrors.ValidationError {
      constructor(payload, status = 400) { super({ message: payload.error, status }); }
    }
    const isValidDateString = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(value + 'T00:00:00Z');
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    root.FinoValidation = factory({ DomainError: ValidationError, isValidDateString, constants: root.FinoConstants });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function ({ DomainError, isValidDateString, constants }) {


const { CURRENCIES, SYNC_ACTIONS } = constants;
function fail(field, message) { throw new DomainError({ error: message || `Invalid ${field}.` }, 400); }
function object(value, field = 'request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, `${field} must be an object.`);
}
function number(value, field) {
  // HTML forms intentionally send numeric strings. Booleans, blanks and coercible objects are never numbers.
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0) fail(field, `${field} must be a finite nonnegative number.`);
}
function validateIdentifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail('identifier', 'A nonempty record identifier is required.');
}
function validateRequest(kind, body) {
  object(body);
  const required = {
    asset: [], // Preserve the existing domain messages for missing asset basics.
    buy: ['quantity', 'purchasePrice', 'purchaseDate'],
    sale: ['quantity', 'sellPrice', 'sellDate'],
    note: ['date', 'assetId', 'text'],
    payment: ['assetId', 'type', 'date', 'amount'],
    transaction: ['assetId', 'type', 'date', 'amount'],
  }[kind] || [];
  for (const key of required) if (body[key] == null || body[key] === '') fail(key, `${key} is required.`);
  if (kind === 'merge' && (!Array.isArray(body.assetIds) || new Set(body.assetIds).size < 2)) fail('assetIds', 'At least two holdings are required to merge.');
  if (kind === 'sale' && !body.assetId && !body.assetIds?.length) fail('assetId', 'Asset is required.');
  if (kind === 'payment' && !constants.PAYMENT_TYPES.includes(body.type)) fail('type', 'Invalid payment type.');
  if (kind === 'transaction' && !['BUY', 'SELL', ...constants.PAYMENT_TYPES].includes(body.type)) fail('type', 'Invalid transaction type.');
  if (kind === 'payment' && body.status != null && body.status !== 'planned') fail('status', 'New payments must be planned; use the received endpoint to record receipt.');
  if (kind === 'note' && (typeof body.text !== 'string' || !body.text.trim() || typeof body.assetId !== 'string' || !body.assetId.trim())) fail('note', 'Asset and note text are required.');
  if (kind === 'asset' && body.name && body.type && body.purchasePrice === undefined) fail('purchasePrice', 'purchasePrice is required.');
  if (kind === 'asset' && ['ovdp', 'novapay', 'deposit'].includes(body.type) && !isValidDateString(body.maturityDate)) fail('maturityDate', 'Valid maturityDate is required.');
  for (const key of ['quantity', 'purchasePrice', 'sellPrice', 'currentPrice', 'amount', 'amountPerUnit', 'annualRate', 'maturityAmount', 'redemptionValue', 'dividendPerUnit', 'termMonths']) {
    const optionalNull = body[key] === null && (kind === 'payment' && key === 'amountPerUnit' || kind === 'transaction' && (key === 'purchasePrice' || key === 'quantity' && !['BUY', 'SELL'].includes(body.type)));
    if (body[key] !== undefined && !optionalNull) number(body[key], key);
  }
  for (const key of ['name', 'type', 'assetId', 'text', 'ticker', 'symbol', 'isin', 'instrumentName', 'instrumentType', 'instrumentId', 'paymentId']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') fail(key);
  }
  for (const key of ['purchaseDate', 'sellDate', 'date', 'maturityDate', 'firstDividendDate', 'recordDate']) {
    if (body[key] !== undefined && body[key] !== '' && !isValidDateString(body[key])) fail(key, `${key} must be a valid YYYY-MM-DD date.`);
  }
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !CURRENCIES.includes(body.currency.trim().toUpperCase()))) fail('currency');
  if (body.termMonths !== undefined && (!Number.isInteger(Number(body.termMonths)) || Number(body.termMonths) < 1 || Number(body.termMonths) > 12)) fail('termMonths');
  if (body.annualRate !== undefined && Number(body.annualRate) > 1000) fail('annualRate', 'Annual rate must be between 0 and 1000 percent.');
  if (body.dividendRecordRule !== undefined && !constants.DIVIDEND_RECORD_RULES.includes(body.dividendRecordRule)) fail('dividendRecordRule');
  if (body.purchaseDate && body.maturityDate && body.maturityDate <= body.purchaseDate) fail('maturityDate', 'Maturity date must follow purchase date.');
  if (body.purchaseDate && body.firstDividendDate && body.firstDividendDate < body.purchaseDate) fail('firstDividendDate', 'First dividend date cannot precede purchase date.');
  for (const [a, b] of [['quantity', 'purchasePrice'], ['quantity', 'sellPrice'], ['quantity', 'currentPrice'], ['quantity', 'dividendPerUnit'], ['quantity', 'redemptionValue']]) {
    if (body[a] !== undefined && body[b] !== undefined && !Number.isFinite(Number(body[a]) * Number(body[b]))) fail(b, 'Financial totals must be finite.');
  }
  if (body.quantity !== undefined && body.purchasePrice !== undefined && body.maturityDate && body.purchaseDate && body.annualRate !== undefined) {
    const days = (Date.parse(body.maturityDate + 'T00:00:00Z') - Date.parse(body.purchaseDate + 'T00:00:00Z')) / 86400000;
    if (!Number.isFinite(Number(body.quantity) * Number(body.purchasePrice) * (1 + Number(body.annualRate) * days / 36500))) fail('maturity payout', 'Maturity payout must be finite.');
  }
  for (const key of ['earlyWithdrawal', 'isNewInstrument']) if (body[key] !== undefined && typeof body[key] !== 'boolean') fail(key);
  if (body.assetIds !== undefined && (!Array.isArray(body.assetIds) || !body.assetIds.length || body.assetIds.some(id => typeof id !== 'string' || !id.trim()))) fail('assetIds');
  if (body.coupons !== undefined) {
    if (!Array.isArray(body.coupons)) fail('coupons');
    const dates = new Set();
    for (const coupon of body.coupons) {
      object(coupon, 'coupon');
      if (!isValidDateString(coupon.date) || (body.purchaseDate && coupon.date < body.purchaseDate) || (body.maturityDate && coupon.date > body.maturityDate) || dates.has(coupon.date)) fail('coupon date');
      dates.add(coupon.date);
      number(coupon.amountPerUnit, 'coupon amountPerUnit');
      if (Number(coupon.amountPerUnit) <= 0) fail('coupon amountPerUnit');
      if (body.quantity !== undefined && !Number.isFinite(Number(body.quantity) * Number(coupon.amountPerUnit))) fail('coupon amount');
    }
  }
  return body;
}
function validateWallet(wallet) {
  object(wallet, 'wallet');
  if (!Array.isArray(wallet.expenses)) fail('expenses');
  object(wallet.months, 'wallet months');
  if (wallet.loans !== undefined && (!Array.isArray(wallet.loans) || wallet.loans.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) fail('loans');
  for (const expense of wallet.expenses) {
    object(expense, 'expense');
    if (!isValidDateString(expense.date)) fail('expense date');
    if (typeof expense.category !== 'string' || !expense.category.trim()) fail('expense category');
    number(expense.amount, 'expense amount');
    if (Number(expense.amount) <= 0) fail('expense amount');
    if (expense.note !== undefined && typeof expense.note !== 'string') fail('expense note');
  }
  for (const [key, month] of Object.entries(wallet.months)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) fail('wallet month key');
    object(month, 'wallet month');
    if (month.plans !== undefined) { object(month.plans, 'wallet plans'); for (const amount of Object.values(month.plans)) number(amount, 'planned amount'); }
    if (month.customCategories !== undefined && (!Array.isArray(month.customCategories) || month.customCategories.some(item => typeof item !== 'string'))) fail('customCategories');
    if (month.notes !== undefined && (!Array.isArray(month.notes) || month.notes.some(item => !item || typeof item !== 'object' || Array.isArray(item) || typeof item.text !== 'string'))) fail('notes');
  }
  for (const loan of wallet.loans || []) {
    for (const field of ['amount', 'balance', 'monthlyPayment', 'paymentDay']) if (loan[field] !== undefined) number(loan[field], 'loan ' + field);
    for (const field of ['dueDate', 'lastPaymentDate']) if (loan[field] != null && loan[field] !== '' && !isValidDateString(loan[field])) fail('loan ' + field);
    for (const field of ['manualSchedule', 'repayments']) {
      if (loan[field] === undefined) continue;
      if (!Array.isArray(loan[field])) fail('loan ' + field);
      for (const payment of loan[field]) { object(payment, 'loan payment'); if (!isValidDateString(payment.date)) fail('loan payment date'); number(payment.amount, 'loan payment amount'); }
    }
  }
  return wallet;
}
function validateSyncAction(action) { if (!SYNC_ACTIONS.includes(action)) fail('sync action'); return action; }
function validateSyncOptions(action, options = {}) {
  validateSyncAction(action); object(options, 'sync options');
  if (Object.keys(options).some(key => key !== 'previewToken')) fail('sync options');
  if (options.previewToken !== undefined && (!['upload', 'download'].includes(action) || typeof options.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(options.previewToken))) fail('previewToken');
  return options;
}
function validateQuantity(value, type) {
  number(value, 'quantity');
  if (Number(value) <= 0 || (!constants.FRACTIONAL_ASSET_TYPES.includes(type) && !Number.isInteger(Number(value)))) fail('quantity', 'Quantity must be greater than zero and use the supported precision for this asset.');
}
function validateAssetInput(body, { partial = false } = {}) {
  validateRequest(partial ? 'patch' : 'asset', body);
  if (!partial || body.name !== undefined) if (typeof body.name !== 'string' || !body.name.trim()) fail('name', 'Asset name is required.');
  if (!partial || body.type !== undefined) if (!constants.ASSET_TYPES.includes(body.type)) fail('type', 'Invalid asset type.');
  if (!partial || body.quantity !== undefined) validateQuantity(body.quantity, body.type);
  if (!partial || body.purchasePrice !== undefined) number(body.purchasePrice, 'purchasePrice');
  if (!partial || body.purchaseDate !== undefined) if (!isValidDateString(body.purchaseDate)) fail('purchaseDate', 'Valid purchase date is required.');
  if (['ovdp', 'deposit', 'novapay'].includes(body.type) && !isValidDateString(body.maturityDate)) fail('maturityDate', 'Valid maturityDate is required.');
  if (body.type === 'deposit' && body.annualRate === undefined) fail('annualRate', 'Deposit annual rate is required.');
  if (body.type === 'novapay' && (Number(body.maturityAmount) <= 0 || body.maturityAmount === undefined || body.termMonths === undefined)) fail('maturityAmount', 'NovaPay term and positive maturity payout are required.');
  if (body.type === 'crypto_earn' && !(Number(body.annualRate) > 0)) fail('annualRate', 'Crypto Earn APR must be greater than zero.');
  if (['inzhur_reit', 's1_reit'].includes(body.type)) {
    if (!(Number(body.dividendPerUnit) > 0)) fail('dividendPerUnit', 'Dividend per unit must be greater than zero.');
    if (!isValidDateString(body.firstDividendDate)) fail('firstDividendDate', 'Valid first dividend date is required.');
  }
  if (body.type === 'ovdp' && !body.coupons?.length) fail('coupons', 'At least one valid coupon is required.');
  return body;
}
function normalizePurchase(body) {
  object(body);
  return { ...body, purchasePrice: body.purchasePrice ?? body.price, purchaseDate: body.purchaseDate ?? body.date };
}
function assetInput(body) {
  validateAssetInput(body);
  const fields = ['operationId', 'name', 'type', 'currency', 'quantity', 'purchasePrice', 'purchaseDate', 'currentPrice', 'ticker', 'isin',
    'instrumentName', 'instrumentType', 'isNewInstrument', 'coupons', 'redemptionValue', 'dividendPerUnit', 'firstDividendDate',
    'dividendRecordRule', 'maturityDate', 'maturityAmount', 'annualRate', 'earlyWithdrawal', 'termMonths'];
  const result = Object.fromEntries(fields.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
  result.name = result.name.trim(); result.currency = (result.currency || 'UAH').trim().toUpperCase();
  for (const key of ['quantity', 'purchasePrice', 'currentPrice', 'redemptionValue', 'dividendPerUnit', 'maturityAmount', 'annualRate', 'termMonths']) if (result[key] !== undefined) result[key] = Number(result[key]);
  for (const key of ['instrumentName', 'instrumentType']) if (result[key] !== undefined) result[key] = result[key].trim();
  for (const key of ['ticker', 'isin']) if (result[key] !== undefined) result[key] = result[key].trim().toUpperCase();
  if (result.coupons) result.coupons = result.coupons.map(coupon => ({ date: coupon.date, amountPerUnit: Number(coupon.amountPerUnit) }));
  return result;
}
function normalizeWallet(wallet, createId) {
  validateWallet(wallet);
  return { ...wallet, expenses: wallet.expenses.map(expense => ({ id: expense.id || createId('expense'),
    createdAt: expense.createdAt || new Date().toISOString(), date: expense.date, category: expense.category.trim(),
    amount: Number(expense.amount), note: (expense.note || '').trim(), currency: 'UAH' })) };
}
function validateAssetCurrency(body, asset) {
  if (body.currency !== undefined && body.currency.trim().toUpperCase() !== (asset.currency || 'UAH')) fail('currency', 'Currency must match the asset.');
}
function validateQuery(query) {
  object(query, 'query');
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== 'string') fail(key, `${key} must occur once and be a string.`);
    if (['startDate', 'endDate'].includes(key) && !isValidDateString(value)) fail(key);
    if (['symbol', 'code', 'ticker', 'interval'].includes(key) && (!value.trim() || value.length > 100)) fail(key);
    if (key === 'outputsize' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 5000)) fail(key);
  }
  if (query.startDate && query.endDate && query.startDate > query.endDate) fail('date range');
  return query;
}
const queryContracts = {
  '/api/sync/preview': [],
  '/api/data': ['sync'],
  '/api/market-data/time-series': ['symbol', 'interval', 'outputsize', 'startDate', 'endDate'],
  '/api/market-data/index-history': ['symbol', 'startDate', 'endDate'],
  '/api/market-data/currency-history': ['code', 'startDate', 'endDate'],
  '/api/market-data/frankfurter-history': ['ticker', 'startDate', 'endDate'],
};
function validateApiQuery(path, query) {
  validateQuery(query);
  if (queryContracts[path] && Object.keys(query).some(key => !queryContracts[path].includes(key))) fail('query', 'Unsupported query parameter.');
  if (query.sync !== undefined && !['true', 'false'].includes(query.sync)) fail('sync');
  return query;
}
function validateReadOptions(options = {}) {
  object(options, 'options');
  if (options.sync !== undefined && typeof options.sync !== 'boolean') fail('sync');
}
function queryParameters(parameters = {}, path) {
  object(parameters, 'query');
  const query = Object.fromEntries(Object.entries(parameters).filter(([, value]) => value !== undefined).map(([key, value]) =>
    [key, typeof value === 'number' && Number.isFinite(value) ? String(value) : value]));
  return validateApiQuery(path, query);
}
function currencyHistoryRange({ startDate, endDate } = {}) {
  const end = endDate || new Date().toISOString().slice(0, 10);
  if (!isValidDateString(end)) fail('endDate');
  const previous = new Date(end + 'T12:00:00Z'), month = previous.getUTCMonth();
  previous.setUTCFullYear(previous.getUTCFullYear() - 1);
  if (previous.getUTCMonth() !== month) previous.setUTCDate(0);
  const start = startDate || previous.toISOString().slice(0, 10);
  if (!isValidDateString(start) || start > end) fail('startDate');
  return { startDate: start, endDate: end };
}
return { validateRequest, validateWallet, validateSyncAction, validateSyncOptions, validateQuery, validateAssetCurrency, validateAssetInput, validateQuantity,
  normalizePurchase, assetInput, normalizeWallet, queryParameters, validateApiQuery, validateReadOptions, validateIdentifier, currencyHistoryRange };

});

