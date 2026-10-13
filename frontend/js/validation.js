// One set of raw-input rules for HTTP domain services and native local operations.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    class ValidationError extends Error {
      constructor(payload, status = 400) { super(payload.error); this.payload = { ...payload, code: 'VALIDATION_FAILURE', category: 'validation' }; this.status = status; this.category = 'validation'; this.code = 'VALIDATION_FAILURE'; }
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
function validateRequest(kind, body) {
  object(body);
  const required = {
    asset: [], // Preserve the existing domain messages for missing asset basics.
    buy: ['quantity', 'purchasePrice', 'purchaseDate'],
    sale: ['quantity', 'sellPrice', 'sellDate'],
    note: ['date', 'assetId', 'text'],
  }[kind] || [];
  for (const key of required) if (body[key] == null || body[key] === '') fail(key, `${key} is required.`);
  if (kind === 'note' && (typeof body.text !== 'string' || !body.text.trim() || typeof body.assetId !== 'string' || !body.assetId.trim())) fail('note', 'Asset and note text are required.');
  if (kind === 'asset' && body.name && body.type && body.purchasePrice === undefined) fail('purchasePrice', 'purchasePrice is required.');
  if (kind === 'asset' && ['ovdp', 'novapay', 'deposit'].includes(body.type) && !isValidDateString(body.maturityDate)) fail('maturityDate', 'Valid maturityDate is required.');
  for (const key of ['quantity', 'purchasePrice', 'sellPrice', 'currentPrice', 'amount', 'annualRate', 'maturityAmount', 'redemptionValue', 'dividendPerUnit', 'termMonths']) {
    if (body[key] !== undefined) number(body[key], key);
  }
  for (const key of ['name', 'type', 'assetId', 'text', 'ticker', 'symbol', 'isin', 'instrumentName', 'instrumentType']) {
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
    for (const field of ['customCategories', 'notes']) if (month[field] !== undefined && !Array.isArray(month[field])) fail(field);
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
  return body;
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
function validateHttpRequest(req, res, next) {
  try {
    validateQuery(req.query);
    if (req.body !== undefined) require('../../frontend/js/state-model').validateJson(req.body);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.body !== undefined) object(req.body);
    if (req.path === '/api/assets/merge') validateRequest('merge', req.body);
    if (['/api/google-drive/sync', '/api/sync/google-drive'].includes(req.path)) {
      for (const key of ['action', 'direction']) if (req.body?.[key] !== undefined) validateSyncAction(req.body[key]);
      if (req.body?.action && req.body?.direction && req.body.action !== req.body.direction) fail('sync direction');
    }
    next();
  } catch (error) { next(error); }
}
return { validateRequest, validateWallet, validateSyncAction, validateQuery, validateHttpRequest, validateAssetCurrency, validateAssetInput, validateQuantity };

});

