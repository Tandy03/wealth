(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoPortfolioFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ state, market, values }) {
    const { normalizeNumber, getDateString } = values;
    const { toUAH, toUAHAtDate, toUAHPurchaseCost, getExchangeRateOnDate } = market;
function getAssetInvestedUah(asset, quantity = getAvailableQuantity(asset.id)) {
  if (asset.type === "crypto_earn") {
    quantity = Math.min(quantity, Math.max(0, normalizeNumber(asset.quantity) - getSoldQuantity(asset.id)));
  }
  return toUAHPurchaseCost(
    quantity * normalizeNumber(asset.purchasePrice),
    asset.currency,
    asset.id,
    asset.purchaseDate,
  );
}

function getAssetInvestedUsd(asset, quantity = getAvailableQuantity(asset.id)) {
  if (asset.type === "crypto_earn") {
    quantity = Math.min(quantity, Math.max(0, normalizeNumber(asset.quantity) - getSoldQuantity(asset.id)));
  }
  const purchases = (state.data.transactions || []).filter(
    (transaction) => transaction.assetId === asset.id && transaction.type === "BUY",
  );
  const totalQuantity = purchases.reduce((sum, transaction) => sum + normalizeNumber(transaction.quantity), 0);
  const investedUsd = purchases.reduce((sum, transaction) => {
    const currency = String(transaction.currency || asset.currency || "UAH").toUpperCase();
    const amount = normalizeNumber(transaction.amount) ||
      normalizeNumber(transaction.quantity) * normalizeNumber(transaction.purchasePrice ?? transaction.price);
    if (currency === "USD") return sum + amount;
    const amountUah = currency === "UAH" ? amount : toUAHAtDate(amount, currency, transaction.date);
    return sum + amountUah / getExchangeRateOnDate("USD", transaction.date || asset.purchaseDate);
  }, 0);
  if (totalQuantity > 0) return investedUsd * Math.min(1, normalizeNumber(quantity) / totalQuantity);

  const amount = normalizeNumber(quantity) * normalizeNumber(asset.purchasePrice);
  const currency = String(asset.currency || "UAH").toUpperCase();
  if (currency === "USD") return amount;
  const amountUah = currency === "UAH" ? amount : toUAHAtDate(amount, currency, asset.purchaseDate);
  return amountUah / getExchangeRateOnDate("USD", asset.purchaseDate);
}

function getSoldQuantity(assetId) {
  return (state.data.sales || [])
    .filter((sale) => sale.assetId === assetId)
    .reduce((sum, sale) => sum + normalizeNumber(sale.quantity), 0);
}

function getCryptoEarnQuantity(asset, targetDate = getDateString(new Date())) {
  const annualRate = Math.max(0, normalizeNumber(asset.annualRate)) / 100;
  const targetTime = new Date(`${targetDate}T00:00:00Z`).getTime();
  const purchases = (state.data.transactions || []).filter(
    (transaction) => transaction.assetId === asset.id && transaction.type === "BUY" && transaction.date,
  );
  const sources = purchases.length
    ? purchases.map((transaction) => ({ date: transaction.date, quantity: normalizeNumber(transaction.quantity) }))
    : [{ date: asset.purchaseDate, quantity: normalizeNumber(asset.quantity) }];
  const accrued = sources.reduce((sum, source) => {
    const startTime = new Date(`${source.date}T00:00:00Z`).getTime();
    const days = Number.isFinite(startTime) ? Math.max(0, Math.floor((targetTime - startTime) / 86400000)) : 0;
    return sum + source.quantity * ((1 + annualRate / 365) ** days);
  }, 0);
  const removed = (state.data.sales || []).filter((sale) => sale.assetId === asset.id && sale.sellDate).reduce((sum, sale) => {
    const soldTime = new Date(`${sale.sellDate}T00:00:00Z`).getTime();
    const days = Number.isFinite(soldTime) ? Math.max(0, Math.floor((targetTime - soldTime) / 86400000)) : 0;
    return sum + normalizeNumber(sale.quantity) * ((1 + annualRate / 365) ** days);
  }, 0);
  return Math.max(0, accrued - removed);
}

function getAvailableQuantity(assetId) {
  const asset = state.data.assets.find((item) => item.id === assetId);

  if (!asset) {
    return 0;
  }

  const hasReceivedMaturity =
    asset.type === "ovdp" &&
    (state.data.payments || []).some(
      (payment) =>
        payment.assetId === assetId &&
        payment.type === "MATURITY" &&
        (payment.status === "received" || payment.status === "paid"),
    );

  if (asset.closedAt || hasReceivedMaturity) {
    return 0;
  }

  if (asset.type === "crypto_earn") return getCryptoEarnQuantity(asset);

  const originalQuantity = normalizeNumber(asset.quantity);

  const soldQuantity = getSoldQuantity(assetId);

  return Math.max(0, originalQuantity - soldQuantity);
}

function getMaturityCostBasis(assetId) {
  const asset = state.data.assets.find((item) => item.id === assetId);

  return asset
    ? Math.max(0, normalizeNumber(asset.quantity) - getSoldQuantity(assetId)) *
      normalizeNumber(asset.purchasePrice)
    : 0;
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
  if (["savings", "novapay", "deposit"].includes(asset.type)) return 0;
  if (asset.type === "crypto_earn") {
    const available = getAvailableQuantity(asset.id);
    const principal = Math.max(0, normalizeNumber(asset.quantity) - getSoldQuantity(asset.id));
    return available * getCurrentPrice(asset) - principal * normalizeNumber(asset.purchasePrice);
  }
  return getAvailableQuantity(asset.id) *
    (getCurrentPrice(asset) - normalizeNumber(asset.purchasePrice));
}

function getGroupedSaleCost(assets, quantity) {
  let remaining = quantity;
  let cost = 0;
  assets.forEach((asset) => {
    if (remaining <= 0) return;
    const taken = Math.min(remaining, getAvailableQuantity(asset.id));
    cost += taken * normalizeNumber(asset.purchasePrice);
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
