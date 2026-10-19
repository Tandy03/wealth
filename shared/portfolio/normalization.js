(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calculations'), require('../state-contract'));
  else root.FinoPortfolioNormalization = factory(root.FinoPortfolioCalculations, root.FinoStateContract);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (calculations, contract) {
  const { number, day, today, received, assetFor, hasCost, costOf, purchases, holdingsAtDate, quantityOnDate, dividendRecordDate, quantityForSale, consumeLots, maturityPayout } = calculations;
  function updateHolding(data, asset) {
    const holding = holdingsAtDate(data, asset);
    if (holding.unknownQuantity > 0 && asset.legacyPurchaseCost == null) asset.legacyPurchaseCost = holding.legacyCost;
    asset.remainingQuantity = quantityOnDate(data, asset);
    asset.remainingCostBasis = holding.remainingCost;
    if (holding.remainingQuantity > 0) asset.purchasePrice = holding.averagePrice;
    return holding;
  }
  function updateSinglePurchase(data, asset) {
    const buys = (data.transactions || []).filter(tx => tx.assetId === asset.id && tx.type === 'BUY' && contract.isTransactionCompleted(tx));
    if (buys.length === 1 && !(data.sales || []).some(sale => sale.assetId === asset.id)) {
      Object.assign(buys[0], { quantity: number(asset.quantity), purchasePrice: number(asset.purchasePrice), amount: number(asset.quantity) * number(asset.purchasePrice), date: asset.purchaseDate });
    }
    if (!(data.sales || []).some(sale => sale.assetId === asset.id) && buys.length <= 1) delete asset.legacyPurchaseCost;
  }
  function completeLegacyPurchases(data, asset, createId) {
    const holding = holdingsAtDate(data, asset);
    for (const purchase of purchases(data, asset)) {
      if (hasCost(purchase)) continue;
      const price = holding.legacyCost / (holding.unknownQuantity || 1);
      Object.assign(purchase, { purchasePrice: price, amount: number(purchase.quantity) * price });
      if (!data.transactions.includes(purchase)) {
        purchase.id = createId('tx'); purchase.assetId = asset.id; purchase.assetName = asset.name;
        purchase.type = 'BUY'; purchase.currency = asset.currency || 'UAH'; purchase.source = 'legacy';
        data.transactions.push(purchase);
      }
    }
    delete asset.legacyPurchaseCost;
  }
  function repairLegacyPurchaseHistory(data) {
    for (const asset of data.assets || []) {
      const buys = (data.transactions || []).filter(tx => tx.assetId === asset.id && tx.type === 'BUY' && contract.isTransactionCompleted(tx));
      const excess = buys.reduce((sum, tx) => sum + number(tx.quantity), 0) - number(asset.quantity);
      if (excess <= 1e-8 || !buys.length) continue;
      const earliest = [...buys].sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)))[0];
      const quantity = number(earliest.quantity) - excess;
      if (quantity <= 0) continue;
      const otherCost = buys.filter(tx => tx !== earliest).reduce((sum, tx) => sum + number(tx.amount), 0);
      const cost = Math.max(0, number(asset.quantity) * number(asset.purchasePrice) - otherCost);
      Object.assign(earliest, { quantity, amount: cost, purchasePrice: cost / quantity });
      delete earliest.price;
    }
  }
  return { updateHolding, updateSinglePurchase, completeLegacyPurchases, repairLegacyPurchaseHistory };
});
