import contract from '../../shared/state-contract.js';
import readers from './state-store.js';
const implementation = (function (contract, readers) {
  function createService({ state, selectData, selectUI, market, finance, values }) {
    ({ selectData, selectUI } = readers.createReader({ state, selectData, selectUI }));
    const { normalizeNumber, getDateString, isDateInRange } = values;
    const { getMaturityCostBasis } = finance;
function calculateXirr(cashFlows) {
  const grouped = new Map();
  cashFlows.forEach(({ date, amount }) => {
    const normalizedDate = String(date || "").slice(0, 10);
    if (!validDate(normalizedDate) || !Number.isFinite(amount) || amount === 0) return;
    grouped.set(normalizedDate, (grouped.get(normalizedDate) || 0) + amount);
  });
  const flows = [...grouped].filter(([, amount]) => amount !== 0 && Number.isFinite(amount)).map(([date, amount]) => ({ date: new Date(`${date}T00:00:00Z`), amount })).sort((a, b) => a.date - b.date);
  if (flows.length < 2 || !flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const origin = flows[0].date.getTime();
  const scale = flows.reduce((maximum, flow) => Math.max(maximum, Math.abs(flow.amount)), 0);
  const normalized = flows.map(flow => ({ amount: flow.amount / scale, years: (flow.date.getTime() - origin) / 31536000000 }));
  const npv = rate => {
    const log = Math.log1p(rate), shift = rate < 0 ? -normalized.at(-1).years * log : 0;
    return normalized.reduce((sum, flow) => sum + flow.amount * Math.exp(-flow.years * log - shift), 0);
  };
  let low = -0.9999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (Math.sign(lowValue) === Math.sign(highValue) && high < 1000000) {
    high *= 2;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (!Number.isFinite(middleValue)) return null;
    if (middleValue === 0 || high - low < 1e-12 * Math.max(1, Math.abs(middle))) return middle;
    if (Math.sign(lowValue) !== Math.sign(middleValue)) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
}

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const paidDate = payment => String(payment.receivedDate || payment.receivedAt || payment.date || '').slice(0, 10);
const uniqueRecords = contract.uniqueFinancialRecords;
function cashEvents(asOf) {
  const assets = new Map((selectData().assets || []).map(asset => [asset.id, asset]));
  const transactions = uniqueRecords((selectData().transactions || []).filter(contract.isTransactionCompleted), 'transaction');
  const sales = uniqueRecords(selectData().sales || [], 'sale');
  const payments = uniqueRecords((selectData().payments || []).filter(contract.isPaymentCompleted), 'payment');
  const allBuyAssets = new Set((selectData().transactions || []).filter(tx => tx.type === 'BUY').map(tx => tx.assetId));
  const saleIds = new Set(sales.map(sale => sale.id).filter(Boolean));
  const saleKey = (assetId, date, quantity, proceeds) => JSON.stringify([assetId, date, Number(quantity), Number(proceeds)]);
  const mirroredSales = new Set(sales.map(sale => saleKey(sale.assetId, sale.sellDate, sale.quantity, sale.saleProceeds ?? Number(sale.quantity) * Number(sale.sellPrice))));
  const flows = [], purchaseDates = []; let missingDates = 0, missingAmounts = 0, inferredHistory = false;
  const add = (date, amount, currency, kind, record) => {
    const day = String(date || '').slice(0, 10);
    if (!validDate(day)) { missingDates++; return; }
    if (day > asOf) return;
    if (amount === null || !Number.isFinite(amount)) { missingAmounts++; return; }
    flows.push({ date: day, amount, currency: currency || 'UAH', kind, record });
    if (kind === 'BUY') purchaseDates.push(day);
  };
  const cost = tx => tx.amount != null ? Number(tx.amount) : tx.purchasePrice != null || tx.price != null ? Number(tx.quantity) * Number(tx.purchasePrice ?? tx.price) : null;
  for (const tx of transactions) if (tx.type === 'BUY' && (assets.get(tx.assetId)?.type || tx.assetType) !== 'savings') add(tx.date, cost(tx) === null ? null : -cost(tx), tx.currency || assets.get(tx.assetId)?.currency, 'BUY', tx);
  for (const asset of assets.values()) {
    if (asset.type === 'savings' || allBuyAssets.has(asset.id)) continue;
    inferredHistory = true;
    add(asset.purchaseDate, asset.purchasePrice != null ? -Number(asset.quantity) * Number(asset.purchasePrice) : null, asset.currency, 'BUY', asset);
  }
  for (const sale of sales) {
    if ((assets.get(sale.assetId)?.type || sale.type) === 'savings') continue;
    const proceeds = sale.saleProceeds != null ? Number(sale.saleProceeds) : sale.sellPrice != null ? Number(sale.quantity) * Number(sale.sellPrice) : null;
    add(sale.sellDate, proceeds === null ? null : proceeds - Number(sale.fees || 0), sale.currency || assets.get(sale.assetId)?.currency, 'SELL', sale);
  }
  const paymentIds = new Set((selectData().payments || []).map(item => item.id).filter(Boolean));
  for (const payment of payments) if (assets.get(payment.assetId)?.type !== 'savings') add(paidDate(payment), payment.amount == null ? null : Number(payment.amount), payment.currency || assets.get(payment.assetId)?.currency, payment.type, payment);
  for (const tx of transactions) {
    if ((assets.get(tx.assetId)?.type || tx.assetType) === 'savings') continue;
    if (tx.type === 'SELL') {
      if (saleIds.has(tx.saleId) || !tx.saleId && mirroredSales.has(saleKey(tx.assetId, tx.date, tx.quantity, tx.amount))) continue;
      add(tx.date, tx.amount == null ? null : Number(tx.amount) - Number(tx.fees || 0), tx.currency || assets.get(tx.assetId)?.currency, 'SELL', tx);
    } else if (contract.paymentTypes.includes(tx.type) && !(tx.paymentId && paymentIds.has(tx.paymentId))) add(tx.date, tx.amount == null ? null : Number(tx.amount), tx.currency || assets.get(tx.assetId)?.currency, tx.type, tx);
  }
  return { flows, purchaseDates: purchaseDates.sort(), missingDates, missingAmounts, inferredHistory };
}
function calculatePortfolioXirrDetails(snapshot = null, inputEvents = null) {
  const events = inputEvents || cashEvents(snapshot?.asOf || getDateString(new Date())), cashFlows = []; let estimatedFx = 0, missingFx = 0;
  snapshot ||= finance.valuation(getDateString(new Date()), { ...selectData(), transactions: uniqueRecords(selectData().transactions || [], 'transaction'), sales: uniqueRecords(selectData().sales || [], 'sale'), payments: uniqueRecords(selectData().payments || [], 'payment') });
  for (const event of events.flows) {
    const conversion = market.convertWithInfo(event.amount, event.currency, event.date, 'operation-date');
    if (conversion.amount === null) missingFx++; else cashFlows.push({ date: event.date, amount: conversion.amount, fx: conversion });
    if (conversion.estimated) estimatedFx++;
  }
  const assetsWithBuy = new Set(events.flows.filter(event => event.kind === 'BUY').map(event => event.record.assetId || event.record.id));
  const missingHistory = snapshot.rows.filter(row => !assetsWithBuy.has(row.asset.id) || row.historyGap).length;
  const incomplete = snapshot.unpricedCount > 0 || missingFx > 0 || events.missingDates > 0 || events.missingAmounts > 0 || missingHistory > 0;
  if (snapshot.total !== null && snapshot.total > 0) cashFlows.push({ date: snapshot.asOf, amount: snapshot.total });
  return { value: incomplete ? null : calculateXirr(cashFlows), incomplete, estimated: incomplete || estimatedFx > 0 || snapshot.estimatedFx > 0 || snapshot.staleCount > 0 || snapshot.undatedCount > 0 || events.inferredHistory,
    ...events, cashFlows, valuation: snapshot, estimatedFx, missingFx, missingHistory, method: 'operation-date', firstDate: events.purchaseDates[0] || null, lastDate: snapshot.asOf };
}
function calculatePortfolioXirr() { return calculatePortfolioXirrDetails().value; }
function calculateProfit(from = null, to = null) {
  const asOf = getDateString(new Date()), upper = to && to < asOf ? to : asOf;
  const result = { scope: 'realized-period', from, to: upper, asOf, dividends: 0, coupons: 0, maturity: 0, salesProfit: 0, priceGrowth: 0, totalProfit: 0, invested: 0, roi: null,
    assets: {}, fx: {}, estimatedFx: 0, missingFx: 0, missingAmounts: 0, missingDates: 0, method: 'report-date', eventCount: 0 };
  if (from && !validDate(from) || to && !validDate(to) || from && upper && from > upper) { result.invalidPeriod = true; return result; }
  const assets = new Map((selectData().assets || []).map(asset => [asset.id, asset]));
  const convert = (amount, currency) => {
    const info = market.convertWithInfo(amount, currency, asOf);
    const { amount: converted, ...provenance } = info;
    result.fx[currency || 'UAH'] = provenance;
    if (info.estimated) result.estimatedFx++; if (info.amount === null) result.missingFx++;
    return converted;
  };
  const entry = record => {
    const asset = assets.get(record.assetId), name = asset?.name || record.assetName || 'Unknown', type = asset?.type || record.assetType || record.type || 'unknown';
    const key = `${type}::${String(name).trim().toLowerCase()}`;
    return result.assets[key] ||= { assetName: name, currency: 'UAH', invested: 0, dividends: 0, coupons: 0, maturity: 0, salesProfit: 0, priceGrowth: 0 };
  };
  for (const payment of uniqueRecords((selectData().payments || []).filter(contract.isPaymentCompleted), 'payment')) {
    const date = paidDate(payment);
    if (assets.get(payment.assetId)?.type === 'savings') continue;
    if (!validDate(date)) { result.missingDates++; continue; }
    if (!isDateInRange(date, from, upper)) continue;
    const key = ({ DIVIDEND: 'dividends', COUPON: 'coupons', MATURITY: 'maturity' })[payment.type]; if (!key) continue;
    const amount = payment.amount == null ? NaN : Number(payment.amount), basis = payment.type === 'MATURITY' ? Number(payment.costBasis ?? getMaturityCostBasis(payment.assetId)) : 0;
    if (!Number.isFinite(amount) || !Number.isFinite(basis)) { result.missingAmounts++; continue; }
    const income = convert(amount - basis, payment.currency || assets.get(payment.assetId)?.currency); if (income === null) continue;
    const row = entry(payment); result[key] += income; row[key] += income; result.eventCount++;
    if (basis > 0) { const converted = convert(basis, payment.currency || assets.get(payment.assetId)?.currency); if (converted !== null) { row.invested += converted; result.invested += converted; } }
  }
  for (const sale of uniqueRecords(selectData().sales || [], 'sale')) {
    if ((assets.get(sale.assetId)?.type || sale.type) === 'savings') continue;
    if (!validDate(sale.sellDate)) { result.missingDates++; continue; }
    if (!isDateInRange(sale.sellDate, from, upper)) continue;
    const profit = sale.profit != null ? Number(sale.profit) : sale.costBasis != null ? Number(sale.saleProceeds ?? Number(sale.quantity) * Number(sale.sellPrice)) - Number(sale.costBasis) - Number(sale.fees || 0) : null;
    if (profit === null || !Number.isFinite(profit)) { result.missingAmounts++; continue; }
    const currency = sale.currency || assets.get(sale.assetId)?.currency, amount = convert(profit, currency); if (amount === null) continue;
    const row = entry(sale); result.salesProfit += amount; row.salesProfit += amount; result.eventCount++;
    const cost = convert(Number(sale.costBasis || 0), currency); if (cost !== null) { row.invested += cost; result.invested += cost; }
  }
  result.totalProfit = result.dividends + result.coupons + result.maturity + result.salesProfit;
  return result;
}

function getTransactionEffectiveDate(transaction) {
  if (!transaction?.paymentId) return transaction?.date;
  const payment = (selectData().payments || []).find((item) => item.id === transaction.paymentId);
  return payment?.receivedDate || String(payment?.receivedAt || "").slice(0, 10) || transaction.date;
}

function getCalendarEvents() {
  const paymentEvents = groupPaymentEvents(selectData().payments || []);

  const noteEvents = (selectData().calendarNotes || []).map((note) => ({
    id: note.id,
    source: "note",
    date: note.date,
    category: "note",
    title: note.assetName || "Planned purchase",
    amount: note.amount,
    currency: note.currency || "UAH",
    type: "PLANNED_PURCHASE",
    text: note.text,
    assetId: note.assetId,
  }));

  return [...paymentEvents, ...noteEvents];
}

function paymentToCalendarEvent(payment) {
    let category = "coupon";

    if (payment.type === "DIVIDEND") {
      category = "dividend";
    }

    if (payment.type === "MATURITY") {
      category = "maturity";
    }

    return {
      id: payment.id,
      paymentIds: payment.paymentIds || [payment.id],

      source: "payment",

      date: payment.date,

      category,

      title: payment.assetName,

      amount: payment.amount,

      currency: payment.currency,

      type: payment.type,

      assetId: payment.assetId,

      status: payment.status,
    };
}

function groupPaymentEvents(payments) {
  const groups = new Map();
  payments.forEach((payment) => {
    const asset = (selectData().assets || []).find((item) => item.id === payment.assetId);
    const assetName = String(asset?.name || payment.assetName || "Payment").trim();
    const assetType = asset?.type || "";
    const statusGroup = contract.isPaymentCompleted(payment) ? "received" : "planned";
    const key = [payment.date, payment.type, payment.currency || "UAH", assetType, assetName.toLocaleLowerCase(), statusGroup].join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.amount += normalizeNumber(payment.amount);
      existing.paymentIds.push(payment.id);
    } else {
      groups.set(key, paymentToCalendarEvent({ ...payment, assetName, paymentIds: [payment.id] }));
    }
  });
  return [...groups.values()];
}
function summarizeProfit(result, labels = {}) {
  const metrics = ['invested', 'dividends', 'coupons', 'maturity', 'salesProfit', 'priceGrowth'];
  const summarize = row => {
    const totalProfit = metrics.filter(key => key !== 'invested').reduce((sum, key) => sum + normalizeNumber(row[key]), 0);
    return { ...row, totalProfit, roi: result.scope === 'realized-period' ? null : row.invested > 0 ? totalProfit / row.invested * 100 : 0 };
  };
  const assetRows = Object.values(result.assets).map(asset => summarize({ ...asset, label: asset.assetName }));
  const groups = new Map();
  for (const [id, asset] of Object.entries(result.assets)) {
    const type = id.split('::', 1)[0] || 'unknown';
    if (!groups.has(type)) groups.set(type, { label: labels[type] || type, currency: 'UAH', ...Object.fromEntries(metrics.map(key => [key, 0])) });
    const row = groups.get(type);
    for (const key of metrics) row[key] += normalizeNumber(asset[key]);
  }
  return { assetRows, typeRows: [...groups.values()].map(summarize) };
}
    return { cashEvents, calculatePortfolioXirrDetails, summarizeProfit, calculateXirr, calculatePortfolioXirr, calculateProfit, getTransactionEffectiveDate, getCalendarEvents, paymentToCalendarEvent, groupPaymentEvents };
  }
  return { createService };
})(contract, readers);
export default implementation;
export const { createService } = implementation;
