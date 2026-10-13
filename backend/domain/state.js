const model = require('../../frontend/js/state-model');
const { normalizeCurrency } = require('../utils/values');
const { normalizeAssetNames, initializeAssetPriceHistory, repairLegacyPurchaseHistory, updatePlannedPaymentsForAsset } = require('./portfolio');
function updatePlannedPayments(data, assetId) {
  if (assetId) updatePlannedPaymentsForAsset(data, assetId);
  else data.assets.forEach(asset => updatePlannedPaymentsForAsset(data, asset.id));
  return data;
}
function recalculatePortfolio(data) {
  normalizeAssetNames(data);
  initializeAssetPriceHistory(data);
  repairLegacyPurchaseHistory(data);
  data.assets.forEach(asset => require('../../frontend/js/portfolio-rules').updateHolding(data, asset));
  updatePlannedPayments(data);
  const assetIds = new Set(data.assets.map(asset => asset.id));
  data.payments = data.payments.filter(payment => assetIds.has(payment.assetId) || payment.status === 'received' || payment.status === 'paid');
  return data;
}
function normalizeData(input) {
  const data = model.normalizeState(input);
  for (const key of ['assets', 'transactions', 'payments', 'calendarNotes', 'sales']) {
    data[key].forEach(item => { item.currency = normalizeCurrency(item.currency); });
  }
  return recalculatePortfolio(data);
}
module.exports = { ...model, normalizeData, recalculatePortfolio, updatePlannedPayments };
