import model from '../../../shared/state-model.js';
import marketModule from '../market-data.js';
import financeModule from '../analytics/portfolio-finance.js';
import cashflowModule from '../cashflow.js';
import values from '../analytics/values.js';
const implementation = (function (model, marketModule, financeModule, cashflowModule, values) {
  const periods = ['current', '1m', '3m', '6m', '1y', 'ytd', 'all', 'custom'];
  const metrics = ['value', 'invested', 'profit', 'return', 'xirr', 'realized', 'unrealized', 'count'];
  function range(period, today, custom = {}) {
    if (!periods.includes(period) || !model.isDate(today)) throw new Error('Invalid share period.');
    if (period === 'current' || period === 'all') return { from: null, to: today };
    if (period === 'custom') {
      if (!model.isDate(custom.from) || !model.isDate(custom.to) || custom.from > custom.to || custom.to > today) throw new Error('Choose valid dates ending no later than today.');
      return { from: custom.from, to: custom.to };
    }
    const [year, month, day] = today.split('-').map(Number);
    if (period === 'ytd') return { from: year + '-01-01', to: today };
    const months = ({ '1m': 1, '3m': 3, '6m': 6, '1y': 12 })[period];
    const lastDay = new Date(year, month - months, 0, 12).getDate();
    return { from: values.getDateString(new Date(year, month - 1 - months, Math.min(day, lastDay), 12)), to: today };
  }
  function datedServices(data, date, readUI, exchangeRates, historicalRates) {
    const readers = { selectData: () => data, selectUI: readUI }, datedValues = { ...values, getDateString: () => date };
    const market = marketModule.createService({ ...readers, values: datedValues, exchangeRates, historicalRates });
    const finance = financeModule.createService({ ...readers, values: datedValues, market });
    return { ...market, ...finance, ...cashflowModule.createService({ ...readers, values: datedValues, market, finance }) };
  }
  function historicalDocument(data, date) {
    const quotes = new Map();
    for (const point of data.priceHistory || []) {
      const day = String(point.date || point.recordedAt || '').slice(0, 10);
      if (!model.isDate(day) || day > date || point.source === 'initial' || !(Number(point.price) > 0) || !Number.isFinite(Number(point.price))) continue;
      const previous = quotes.get(point.assetId);
      if (!previous || day > String(previous.date || previous.recordedAt).slice(0, 10) || day === String(previous.date || previous.recordedAt).slice(0, 10) && String(point.recordedAt || day) >= String(previous.recordedAt || previous.date)) quotes.set(point.assetId, point);
    }
    return { ...data, assets: (data.assets || []).map(asset => {
      const quote = quotes.get(asset.id), day = String(quote?.date || quote?.recordedAt || '').slice(0, 10);
      return { ...asset, currentPrice: quote ? Number(quote.price) : null, lastSyncedAt: day, priceUpdatedAt: day, lastPriceUpdate: day, priceSource: quote?.source || '' };
    }) };
  }
  function createReport({ data, services, readUI = () => undefined, exchangeRates, historicalRates, period = 'current', custom, today = values.getDateString() }) {
    const dates = range(period, today, custom), lifetime = period === 'current' || period === 'all';
    const source = dates.to < today ? historicalDocument(data, dates.to) : data;
    const financial = lifetime ? services : datedServices(source, dates.to, readUI, exchangeRates, historicalRates);
    const valuation = financial.valuation(dates.to), report = financial.calculateProfit(lifetime ? null : dates.from, dates.to);
    const incompleteRealized = report.missingFx > 0 || report.missingAmounts > 0 || report.missingDates > 0;
    const realized = incompleteRealized ? null : report.totalProfit;
    const profit = realized === null || valuation.unpricedCount ? null : realized + valuation.unrealized;
    const base = valuation.costBasis + report.invested;
    const events = financial.cashEvents(dates.to), xirr = lifetime ? financial.calculatePortfolioXirrDetails(valuation, events) : null;
    const noQuotes = valuation.rows.length > 0 && valuation.rows.every(row => row.value === null);
    const historyGap = valuation.rows.some(row => row.historyGap);
    const result = {
      value: noQuotes || !lifetime && historyGap ? null : valuation.knownValue,
      invested: valuation.missingFx || !lifetime && historyGap ? null : valuation.costBasis,
      profit: lifetime ? profit : null,
      return: lifetime && profit !== null && base > 0 && !valuation.missingFx ? profit / base * 100 : null,
      xirr: xirr?.value ?? null, realized,
      unrealized: noQuotes || !lifetime && historyGap ? null : valuation.unrealized,
      count: historyGap ? null : new Set(valuation.rows.map(row => row.asset.type + '::' + String(row.asset.name).trim().toLowerCase())).size,
    };
    // Same class grouping and purchase-price fallback as Asset Allocation.
    // Historical dates never borrow a current quote when a recorded quote is absent.
    const classes = new Map();
    for (const asset of source.assets || []) {
      if (asset.type === 'savings') continue;
      if (lifetime && !classes.has(asset.type)) classes.set(asset.type, 0);
      const quantity = lifetime ? financial.getAvailableQuantity(asset.id) : valuation.rows.find(row => row.asset.id === asset.id)?.quantity || 0;
      const price = lifetime || dates.to === today ? financial.getCurrentPrice(asset) : Number(asset.currentPrice);
      const amount = lifetime ? financial.toUAH(quantity * price, asset.currency) : financial.convertWithInfo(quantity * price, asset.currency, dates.to).amount;
      if (!(quantity > 0) || !(price > 0) || amount === null || !Number.isFinite(amount)) continue;
      classes.set(asset.type, (classes.get(asset.type) || 0) + amount);
    }
    const allocation = [...classes].filter(([, amount]) => amount > 0).map(([type, amount]) => ({ type, amount }));
    const first = events.purchaseDates[0] || null;
    return { period, from: period === 'all' ? first : dates.from, to: dates.to, currency: 'UAH', metrics: result, allocation,
      partial: Boolean(valuation.unpricedCount || valuation.missingFx || valuation.estimatedFx || valuation.staleCount || valuation.undatedCount || historyGap || report.estimatedFx || incompleteRealized || xirr?.estimated),
      historical: !lifetime, empty: valuation.rows.length === 0, annualized: lifetime, xirrEstimated: Boolean(xirr?.estimated),
      allocationPartial: Boolean(valuation.unpricedCount || valuation.missingFx || historyGap),
    };
  }
  return { periods, metrics, range, createReport };
})(model, marketModule, financeModule, cashflowModule, values);
export default implementation;
export const { createReport, metrics, periods, range } = implementation;
