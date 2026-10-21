(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('../../../shared/portfolio-rules') : root.FinoPortfolioRules, node ? require('../../../shared/state-contract') : root.FinoStateContract, typeof module === 'object' && module.exports ? require('../state-store') : root.FinoStateStore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoPortfolioFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rules, contract, readers) {
  function createService({ state, selectData, selectUI, market, values }) {
    ({ selectData, selectUI } = readers.createReader({ state, selectData, selectUI }));
    const { normalizeNumber, getDateString } = values;
    const { toUAH, toUAHAtDate, toUAHPurchaseCost, getExchangeRateOnDate } = market;
function getAssetInvestedUah(asset, quantity = getAvailableQuantity(asset.id)) {
  const holding = rules.holdingsAtDate(selectData(), asset);
  const cost = holding.remainingCost * Math.min(1, Math.max(0, quantity) / (holding.remainingQuantity || 1));
  return toUAHPurchaseCost(cost, asset.currency, asset.id, asset.purchaseDate);
}
function getAssetInvestedUsd(asset, quantity = getAvailableQuantity(asset.id)) {
  const holding = rules.holdingsAtDate(selectData(), asset);
  const cost = holding.remainingCost * Math.min(1, Math.max(0, quantity) / (holding.remainingQuantity || 1));
  if (asset.currency === 'USD') return cost;
  return toUAHPurchaseCost(cost, asset.currency, asset.id, asset.purchaseDate) / getExchangeRateOnDate('USD', asset.purchaseDate);
}
function getSoldQuantity(assetId) {
  return (selectData().sales || [])
    .filter((sale) => sale.assetId === assetId)
    .reduce((sum, sale) => sum + normalizeNumber(sale.quantity), 0);
}

function getCryptoEarnQuantity(asset, targetDate = getDateString(new Date())) { return rules.quantityOnDate(selectData(), asset, targetDate); }
function getAvailableQuantity(assetId) { return rules.quantityOnDate(selectData(), assetId); }
function getMaturityCostBasis(assetId) {
  const payment = (selectData().payments || []).find(p => p.assetId === assetId && p.type === 'MATURITY' && rules.received(p));
  return payment?.costBasis ?? rules.holdingsAtDate(selectData(), assetId, payment?.receivedDate || payment?.date || getDateString(new Date()), { ignoreClosure: true }).remainingCost;
}
function calculateInvested() {
  return selectData().assets.reduce((sum, asset) => {
    if (asset.type === "savings") return sum;
    const availableQuantity = getAvailableQuantity(asset.id);

    return sum + getAssetInvestedUah(asset, availableQuantity);
  }, 0);
}

function calculateInvestedUsd() {
  return selectData().assets.reduce((sum, asset) => {
    if (asset.type === "savings") return sum;
    return sum + getAssetInvestedUsd(asset, getAvailableQuantity(asset.id));
  }, 0);
}

function getCurrentPrice(asset) {
  const syncedPrice = normalizeNumber(asset.currentPrice);

  return syncedPrice > 0 ? syncedPrice : normalizeNumber(asset.purchasePrice);
}

function calculatePortfolioValue() {
  return selectData().assets.reduce(
    (sum, asset) => sum + (asset.type === "savings" ? 0 : toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency)),
    0,
  );
}

function getUnrealizedPriceGrowth(asset) {
  if (['savings', 'novapay', 'deposit'].includes(asset.type)) return 0;
  return getAvailableQuantity(asset.id) * getCurrentPrice(asset) - rules.holdingsAtDate(selectData(), asset).remainingCost;
}
function valuation(asOf = getDateString(new Date()), data = selectData()) {
  const indexed = {};
  for (const key of ['transactions', 'sales', 'payments']) {
    indexed[key] = new Map();
    for (const item of contract.uniqueFinancialRecords(data[key] || [], key)) { if (!indexed[key].has(item.assetId)) indexed[key].set(item.assetId, []); indexed[key].get(item.assetId).push(item); }
  }
  const history = new Map();
  for (const point of data.priceHistory || []) {
    const previous = history.get(point.assetId);
    if (!previous || String(point.recordedAt || point.date || '') > String(previous.recordedAt || previous.date || '')) history.set(point.assetId, point);
  }
  const rows = [];
  for (const asset of data.assets || []) {
    if (asset.type === 'savings') continue;
    const transactions = indexed.transactions.get(asset.id) || [];
    const buys = transactions.filter(tx => tx.type === 'BUY');
    // Preserve the shared legacy holding rules. A gap between acquired quantity
    // and completed BUY history is reported, never "filled" by a pending order
    // or removed from historical holdings by guessing where it came from.
    const holding = rules.holdingsAtDate({ transactions, sales: indexed.sales.get(asset.id), payments: indexed.payments.get(asset.id) }, asset, asOf);
    if (!(holding.remainingQuantity > 0)) continue;
    const point = history.get(asset.id), price = Number(asset.currentPrice);
    const quote = Number.isFinite(price) && price > 0;
    const rawDate = String(asset.lastSyncedAt || asset.priceUpdatedAt || asset.lastPriceUpdate || (point?.source !== 'initial' ? point?.recordedAt || point?.date : '') || '').slice(0, 10);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && Number.isFinite(Date.parse(rawDate)) && new Date(rawDate + 'T00:00:00Z').toISOString().slice(0, 10) === rawDate && rawDate <= asOf;
    const fresh = quote && validDate && (Date.parse(asOf) - Date.parse(rawDate)) / 86400000 <= 7;
    const fx = market.convertWithInfo(1, asset.currency, asOf);
    const costBasis = fx.amount === null ? null : holding.remainingCost * fx.amount;
    rows.push({ asset, quantity: holding.remainingQuantity, costBasis, value: quote && fx.amount !== null ? holding.remainingQuantity * price * fx.amount : null,
      unrealized: quote && fx.amount !== null ? (holding.remainingQuantity * price - holding.remainingCost) * fx.amount : null,
      fresh, quoteDate: validDate ? rawDate : null, source: String(asset.priceSource || asset.provider || point?.source || 'Manual quote'), fx,
      historyGap: buys.length > 0 && holding.unknownQuantity > 1e-8 });
  }
  const sum = key => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const costBasis = sum('costBasis'), unpricedCount = rows.filter(row => row.value === null).length;
  return { asOf, rows, knownValue: sum('value'), total: unpricedCount ? null : sum('value'), costBasis,
    unrealized: sum('unrealized'), unpricedCount, staleCount: rows.filter(row => row.value !== null && !row.fresh && row.quoteDate).length,
    undatedCount: rows.filter(row => row.value !== null && !row.quoteDate).length,
    freshQuoteShare: costBasis > 0 && rows.every(row => row.costBasis !== null) ? rows.filter(row => row.fresh).reduce((total, row) => total + row.costBasis, 0) / costBasis * 100 : null,
    estimatedFx: rows.filter(row => row.fx.estimated).length, missingFx: rows.filter(row => row.fx.rate === null).length };
}
function concentration(basis = 'market', snapshot = valuation()) {
  const instruments = new Map((selectData().instruments || []).map(item => [item.id, item]));
  const groups = { positions: new Map(), issuers: new Map(), instruments: new Map(), sectors: new Map(), currencies: new Map() };
  let total = 0, excludedCount = 0;
  for (const row of snapshot.rows) {
    const asset = row.asset, instrument = instruments.get(asset.instrumentId);
    const value = basis === 'cost' ? row.costBasis : row.value;
    if (value === null) { excludedCount++; continue; }
    if (!(value > 0)) continue;
    total += value;
    const name = String(asset.name || 'Unknown'), currency = String(asset.currency || 'UAH');
    const identity = asset.isin ? 'isin:' + String(asset.isin).trim().toUpperCase() : [asset.type, asset.ticker || asset.symbol || name.toLowerCase(), currency].join(':');
    const metadata = (...items) => items.find(value => typeof value === 'string' && value.trim())?.trim() || null;
    const labels = { positions: [identity, name], issuers: [metadata(asset.issuer, asset.issuerName, instrument?.issuer, instrument?.issuerName)],
      instruments: [identity, asset.isin || asset.ticker || asset.symbol || name], sectors: [metadata(asset.sector, instrument?.sector)], currencies: [currency] };
    for (const [key, values] of Object.entries(labels)) {
      const label = String(values[1] || values[0] || 'Unknown'), id = values[0] == null ? 'unknown:' : String(values[0]).trim().toLowerCase();
      const current = groups[key].get(id) || { label, value: 0, unknown: values[0] == null };
      current.value += value; groups[key].set(id, current);
    }
  }
  const result = Object.fromEntries(Object.entries(groups).map(([key, map]) => [key, [...map.values()].sort((a, b) => b.value - a.value).map(item => ({ ...item, share: total > 0 ? item.value / total * 100 : 0 }))]));
  return { ...result, total, basis, excludedCount, asOf: snapshot.asOf,
    topOneShare: result.positions[0]?.share || 0, topFiveShare: result.positions.slice(0, 5).reduce((sum, row) => sum + row.share, 0) };
}
function getGroupedSaleCost(assets, quantity) {
  let remaining = quantity;
  let cost = 0;
  assets.forEach((asset) => {
    if (remaining <= 0) return;
    const taken = Math.min(remaining, getAvailableQuantity(asset.id));
      cost += taken * rules.holdingsAtDate(selectData(), asset).averagePrice;
    remaining -= taken;
  });
  return cost;
}
function getRebalanceGroups() {
  return Object.values(
    selectData().assets
      .filter((asset) => getAvailableQuantity(asset.id) > 0 && asset.type !== "savings")
      .reduce((result, asset) => {
        const id = asset.type === "ovdp" ? "ovdp" : `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
        if (!result[id]) {
          result[id] = { id, label: asset.type === "ovdp" ? "OVDP" : asset.name, assets: [] };
        }
        result[id].assets.push(asset);
        return result;
      }, {}),
  ).concat(selectUI('rebalanceDrafts').map((draft) => ({ ...draft, assets: [] })));

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

    return { valuation, concentration, getRebalanceGroups, calculateRebalancePlan, getAssetInvestedUah, getAssetInvestedUsd, getSoldQuantity, getCryptoEarnQuantity, getAvailableQuantity, getMaturityCostBasis, calculateInvested, calculateInvestedUsd, getCurrentPrice, calculatePortfolioValue, getUnrealizedPriceGrowth, getGroupedSaleCost };
  }
  return { createService };
});
