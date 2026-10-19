(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../../shared/portfolio-rules') : root.FinoPortfolioRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoPortfolioFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rules) {
  function createService({ state, market, values }) {
    const { normalizeNumber, getDateString } = values;
    const { toUAH, toUAHAtDate, toUAHPurchaseCost, getExchangeRateOnDate } = market;
function getAssetInvestedUah(asset, quantity = getAvailableQuantity(asset.id)) {
  const holding = rules.holdingsAtDate(state.data, asset);
  const cost = holding.remainingCost * Math.min(1, Math.max(0, quantity) / (holding.remainingQuantity || 1));
  return toUAHPurchaseCost(cost, asset.currency, asset.id, asset.purchaseDate);
}
function getAssetInvestedUsd(asset, quantity = getAvailableQuantity(asset.id)) {
  const holding = rules.holdingsAtDate(state.data, asset);
  const cost = holding.remainingCost * Math.min(1, Math.max(0, quantity) / (holding.remainingQuantity || 1));
  if (asset.currency === 'USD') return cost;
  return toUAHPurchaseCost(cost, asset.currency, asset.id, asset.purchaseDate) / getExchangeRateOnDate('USD', asset.purchaseDate);
}
function getSoldQuantity(assetId) {
  return (state.data.sales || [])
    .filter((sale) => sale.assetId === assetId)
    .reduce((sum, sale) => sum + normalizeNumber(sale.quantity), 0);
}

function getCryptoEarnQuantity(asset, targetDate = getDateString(new Date())) { return rules.quantityOnDate(state.data, asset, targetDate); }
function getAvailableQuantity(assetId) { return rules.quantityOnDate(state.data, assetId); }
function getMaturityCostBasis(assetId) {
  const payment = (state.data.payments || []).find(p => p.assetId === assetId && p.type === 'MATURITY' && rules.received(p));
  return payment?.costBasis ?? rules.holdingsAtDate(state.data, assetId, payment?.receivedDate || payment?.date || getDateString(new Date()), { ignoreClosure: true }).remainingCost;
}
function calculateInvested() {
  return state.data.assets.reduce((sum, asset) => {
    if (asset.type === "savings") return sum;
    const availableQuantity = getAvailableQuantity(asset.id);

    return sum + getAssetInvestedUah(asset, availableQuantity);
  }, 0);
}

function calculateInvestedUsd() {
  return state.data.assets.reduce((sum, asset) => {
    if (asset.type === "savings") return sum;
    return sum + getAssetInvestedUsd(asset, getAvailableQuantity(asset.id));
  }, 0);
}

function getCurrentPrice(asset) {
  const syncedPrice = normalizeNumber(asset.currentPrice);

  return syncedPrice > 0 ? syncedPrice : normalizeNumber(asset.purchasePrice);
}

function calculatePortfolioValue() {
  return state.data.assets.reduce(
    (sum, asset) => sum + (asset.type === "savings" ? 0 : toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency)),
    0,
  );
}

function getUnrealizedPriceGrowth(asset) {
  if (['savings', 'novapay', 'deposit'].includes(asset.type)) return 0;
  return getAvailableQuantity(asset.id) * getCurrentPrice(asset) - rules.holdingsAtDate(state.data, asset).remainingCost;
}
function getGroupedSaleCost(assets, quantity) {
  let remaining = quantity;
  let cost = 0;
  assets.forEach((asset) => {
    if (remaining <= 0) return;
    const taken = Math.min(remaining, getAvailableQuantity(asset.id));
      cost += taken * rules.holdingsAtDate(state.data, asset).averagePrice;
    remaining -= taken;
  });
  return cost;
}
function getRebalanceGroups() {
  return Object.values(
    state.data.assets
      .filter((asset) => getAvailableQuantity(asset.id) > 0 && asset.type !== "savings")
      .reduce((result, asset) => {
        const id = asset.type === "ovdp" ? "ovdp" : `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
        if (!result[id]) {
          result[id] = { id, label: asset.type === "ovdp" ? "OVDP" : asset.name, assets: [] };
        }
        result[id].assets.push(asset);
        return result;
      }, {}),
  ).concat(state.rebalanceDrafts.map((draft) => ({ ...draft, assets: [] })));

}

function calculateRebalancePlan(targets) {
  const total = targets.reduce((sum, item) => sum + item.percent, 0);
  if (targets.some(item => !Number.isFinite(item.percent) || item.percent < 0 || item.percent > 100) || Math.abs(total - 100) > 0.01) {
    throw new Error("Target shares must total 100% and stay between 0 and 100.");
  }
  const groups = getRebalanceGroups();
  const values = targets.map((target) => {
    const group = groups.find((item) => item.id === target.groupId);
    return {
      ...target,
      group,
      value: (group?.assets || []).reduce(
        (sum, asset) => sum + toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency),
        0,
      ),
    };
  });
  const currentTotal = values.reduce((sum, item) => sum + item.value, 0);
  const totalAfterAddition = Math.max(
    currentTotal,
    ...values.filter((item) => item.percent > 0).map((item) => item.value / (item.percent / 100)),
  );

  const recommendations = values.map((item) => ({
    ...item,
    difference: Math.max(0, totalAfterAddition * (item.percent / 100) - item.value),
  }));
  const totalToInvest = recommendations.reduce((sum, item) => sum + item.difference, 0);

  return { recommendations, totalToInvest };
}

    return { getRebalanceGroups, calculateRebalancePlan, getAssetInvestedUah, getAssetInvestedUsd, getSoldQuantity, getCryptoEarnQuantity, getAvailableQuantity, getMaturityCostBasis, calculateInvested, calculateInvestedUsd, getCurrentPrice, calculatePortfolioValue, getUnrealizedPriceGrowth, getGroupedSaleCost };
  }
  return { createService };
});
