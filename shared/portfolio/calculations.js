(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../state-contract'));
  else root.FinoPortfolioCalculations = factory(root.FinoStateContract);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (contract) {
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const day = value => String(value || '').slice(0, 10);
  const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
  const received = contract.isPaymentCompleted;
  const assetFor = (data, asset) => typeof asset === 'string' ? (data.assets || []).find(item => item.id === asset) : asset;
  const hasCost = purchase => purchase.amount != null || purchase.purchasePrice != null || purchase.price != null;
  const costOf = purchase => purchase.amount != null ? number(purchase.amount) : number(purchase.quantity) * number(purchase.purchasePrice ?? purchase.price);
  function purchases(data, asset) {
    const buys = (data.transactions || []).filter(tx => tx.assetId === asset.id && tx.type === 'BUY' && contract.isTransactionCompleted(tx));
    const missing = Math.max(0, number(asset.quantity) - buys.reduce((sum, tx) => sum + number(tx.quantity), 0));
    return missing > 1e-8 ? [{ quantity: missing, date: asset.purchaseDate }, ...buys] : buys;
  }
  function holdingsAtDate(data, assetOrId, targetDate = today(), { ignoreClosure = false } = {}) {
    const asset = assetFor(data, assetOrId);
    if (!asset) return { purchasedQuantity: 0, remainingQuantity: 0, remainingCost: 0, averagePrice: 0 };
    const allBuys = purchases(data, asset);
    const unknownQuantity = allBuys.filter(tx => !hasCost(tx)).reduce((sum, tx) => sum + number(tx.quantity), 0);
    const legacyCost = asset.legacyPurchaseCost != null ? number(asset.legacyPurchaseCost) : unknownQuantity * number(asset.purchasePrice);
    const buys = allBuys.filter(tx => !tx.date || day(tx.date) <= targetDate);
    const sales = (data.sales || []).filter(sale => sale.assetId === asset.id && (!sale.sellDate || day(sale.sellDate) <= targetDate));
    const purchasedQuantity = buys.reduce((sum, tx) => sum + number(tx.quantity), 0);
    const purchasedCost = buys.reduce((sum, tx) => sum + (hasCost(tx) ? costOf(tx) : number(tx.quantity) * legacyCost / (unknownQuantity || 1)), 0);
    const soldQuantity = sales.reduce((sum, sale) => sum + number(sale.quantity), 0);
    const soldCost = sales.reduce((sum, sale) => sum + (sale.costBasis != null ? number(sale.costBasis) : number(sale.quantity) * number(sale.purchasePrice ?? asset.purchasePrice)), 0);
    const maturity = (data.payments || []).find(payment => payment.assetId === asset.id && payment.type === 'MATURITY' && received(payment));
    const closedDate = day(asset.closedAt) || day(maturity?.receivedDate || maturity?.receivedAt || maturity?.date) || (maturity ? today() : '');
    const closed = !ignoreClosure && Boolean(closedDate && closedDate <= targetDate);
    const factor = date => {
      const days = Math.max(0, (Date.parse(targetDate + 'T00:00:00Z') - Date.parse(day(date) + 'T00:00:00Z')) / 86400000);
      return asset.type === 'crypto_earn' ? (1 + Math.max(0, number(asset.annualRate)) / 36500) ** (Number.isFinite(days) ? days : 0) : 1;
    };
    const balance = asset.type === 'crypto_earn'
      ? buys.reduce((sum, tx) => sum + number(tx.quantity) * factor(tx.date), 0) - sales.reduce((sum, sale) => sum + number(sale.quantity) * factor(sale.sellDate), 0)
      : purchasedQuantity - soldQuantity;
    const precision = Math.max(Math.abs(purchasedQuantity), Math.abs(soldQuantity)) * Number.EPSILON * 8;
    const remainingQuantity = closed || Math.abs(balance) <= precision ? 0 : Math.max(0, balance);
    const remainingCost = remainingQuantity > 0 ? Math.max(0, purchasedCost - soldCost) : 0;
    if (![purchasedQuantity, remainingQuantity, remainingCost, legacyCost].every(Number.isFinite)) {
      const error = new Error('Financial totals must be finite.');
      error.code = 'VALIDATION_FAILURE'; error.status = 400; error.payload = { error: error.message, code: error.code, category: 'validation' }; error.category = 'validation';
      throw error;
    }
    return { purchasedQuantity, remainingQuantity, remainingCost, averagePrice: remainingQuantity > 0 ? remainingCost / remainingQuantity : 0, legacyCost, unknownQuantity };
  }
  function quantityOnDate(data, assetOrId, targetDate = today()) {
    return holdingsAtDate(data, assetOrId, targetDate).remainingQuantity;
  }
  function dividendRecordDate(asset, payment) {
    if (payment.recordDate) return payment.recordDate;
    if (asset.dividendRecordRule === 'payment_date') return payment.date;
    const date = new Date(payment.date + 'T00:00:00Z');
    date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
  }
  function quantityForSale(data, assetOrId, targetDate) {
    const asset = assetFor(data, assetOrId);
    if (!asset || asset.closedAt || (data.payments || []).some(p => p.assetId === asset.id && p.type === 'MATURITY' && received(p))) return 0;
    return Math.min(quantityOnDate(data, asset, targetDate), quantityOnDate(data, asset));
  }
  function consumeLots(lots, requested, factor, proportional = false) {
    let remaining = Math.max(0, number(requested)), basis = 0;
    const total = lots.reduce((sum, lot) => sum + Math.max(0, lot.quantity) * factor(lot), 0);
    const portion = total > 0 ? Math.min(1, remaining / total) : 0;
    for (const lot of lots) {
      if (!proportional && remaining <= 1e-9) break;
      const scale = factor(lot), available = Math.max(0, lot.quantity) * scale;
      const used = proportional ? available * portion : Math.min(available, remaining);
      const principal = used / scale;
      basis += principal * lot.unitCostUah;
      lot.quantity -= principal;
      remaining -= used;
    }
    return { basis, shortfall: Math.max(0, remaining) };
  }
  function maturityPayout(principal, annualRate, purchaseDate, maturityDate) {
    const days = Math.max(0, (Date.parse(maturityDate + 'T00:00:00Z') - Date.parse(purchaseDate + 'T00:00:00Z')) / 86400000);
    return principal * (1 + annualRate / 100 * days / 365);
  }
  return { number, day, today, received, assetFor, hasCost, costOf, purchases, holdingsAtDate, quantityOnDate, dividendRecordDate, quantityForSale, consumeLots, maturityPayout };
});
