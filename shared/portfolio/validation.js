// Domain checks for new operations; never applied to historical document loading.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const errors = require('../errors'), constants = require('../constants'), model = require('../state-model');
    module.exports = factory(require('../validation').createDefault(), errors, constants, model);
  }
  else root.FinoOperationValidation = factory(root.FinoValidation, root.FinoErrors, root.FinoConstants, root.FinoStateModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (requests, errors, constants, model) {
const { CURRENCIES, PAYMENT_TYPES } = constants;
const isValidDateString = model.isDate;
const supportsFractionalQuantity = type => constants.FRACTIONAL_ASSET_TYPES.includes(type);
const isValidQuantity = (quantity, type) => Number.isFinite(quantity) && quantity > 0 && (supportsFractionalQuantity(type) || Number.isInteger(quantity));
const currencies = new Set(CURRENCIES);
const paymentTypes = new Set(PAYMENT_TYPES);
function fail(message, status = 400) { const category = errors.categoryForStatus(status); throw new errors.ApplicationError(message, { status, category, code: status === 404 ? 'DOMAIN_FAILURE' : 'VALIDATION_FAILURE' }); }
function assetFor(data, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('An object request body is required.');
  if (typeof body.assetId !== 'string' || !body.assetId) fail('Asset is required.');
  const asset = data.assets.find((item) => item.id === body.assetId);
  if (!asset) fail('Asset not found.', 404);
  return asset;
}
function date(value, name) {
  if (!isValidDateString(value)) fail('Valid ' + name + ' is required.');
  return value;
}
function nonnegative(value, name) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0) fail(name + ' must be a finite number greater than or equal to zero.');
  return Number(value);
}
function currency(value, asset) {
  const result = value == null ? asset.currency || 'UAH' : String(value).trim().toUpperCase();
  if (!currencies.has(result)) fail('Invalid currency.');
  if (result !== (asset.currency || 'UAH')) fail('Currency must match the asset.');
  return result;
}
function createTransaction(data, body, createId) {
  requests.validateRequest('transaction', body);
  const asset = assetFor(data, body);
  if (!new Set(['BUY', 'SELL', ...paymentTypes]).has(body.type)) fail('Invalid transaction type.');
  const transaction = { id: createId('tx'), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name, type: body.type,
    date: date(body.date, 'transaction date'), amount: nonnegative(body.amount, 'Amount'), currency: currency(body.currency, asset) };
  if (body.type === 'BUY' || body.type === 'SELL' || body.quantity != null) {
    const quantity = nonnegative(body.quantity, 'Quantity');
    if (!isValidQuantity(quantity, asset.type)) fail(supportsFractionalQuantity(asset.type) ? 'Quantity must be greater than zero.' : 'Quantity must be a whole number greater than zero.');
    transaction.quantity = quantity;
  } else transaction.quantity = null;
  if (body.purchasePrice != null) transaction.purchasePrice = nonnegative(body.purchasePrice, 'Purchase price');
  if (body.instrumentId != null) {
    if (typeof body.instrumentId !== 'string') fail('Invalid instrument.');
    transaction.instrumentId = body.instrumentId;
  }
  if (body.paymentId != null) {
    const payment = data.payments.find((item) => item.id === body.paymentId && item.assetId === asset.id && item.type === body.type);
    if (!payment) fail('Payment does not belong to this asset and transaction type.');
    if (data.transactions.some((item) => item.paymentId === body.paymentId)) fail('Payment transaction already exists.');
    transaction.paymentId = payment.id;
  }
  return transaction;
}
function createPayment(data, body, createId) {
  requests.validateRequest('payment', body);
  const asset = assetFor(data, body);
  if (!paymentTypes.has(body.type)) fail('Invalid payment type.');
  if (body.status != null && body.status !== 'planned') fail('New payments must be planned; use the received endpoint to record receipt.');
  const payment = { id: createId('payment'), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name, type: body.type,
    date: date(body.date, 'payment date'), amount: nonnegative(body.amount, 'Amount'), currency: currency(body.currency, asset), status: 'planned' };
  if (body.amountPerUnit != null) payment.amountPerUnit = nonnegative(body.amountPerUnit, 'Amount per unit');
  if (body.recordDate != null) {
    if (body.type !== 'DIVIDEND') fail('Only dividends support a record date.');
    payment.recordDate = date(body.recordDate, 'dividend record date');
    if (payment.recordDate > payment.date) fail('Dividend record date cannot follow payment date.');
  }
  return payment;
}
function createNote(data, body, createId) {
  requests.validateRequest('note', body);
  const asset = assetFor(data, body);
  return { id: createId('note'), createdAt: new Date().toISOString(), date: body.date, assetId: asset.id,
    assetName: asset.name, text: body.text.trim(), amount: Number(body.amount || 0), currency: 'UAH' };
}
return { createTransaction, createPayment, createNote, assetFor };

});
