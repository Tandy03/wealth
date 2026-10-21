(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../shared/state-contract') : root.FinoStateContract, typeof module === 'object' && module.exports ? require('./state-store') : root.FinoStateStore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoMarketData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (contract, readers) {
  function createService({ state, selectData, selectUI, exchangeRates, historicalRates, values, getCustomRange = () => null }) {
    ({ selectData, selectUI } = readers.createReader({ state, selectData, selectUI }));
    const { normalizeNumber } = values;
    const EXCHANGE_RATES = exchangeRates;
    const HISTORICAL_RATE_FALLBACKS = historicalRates;
    const historyIndexes = new Map();
    const MARKET_RANGE_PARAMS = {
  "1D": { interval: "5min", outputsize: 200 },
  "5D": { interval: "30min", outputsize: 200 },
  "1M": { interval: "1day", outputsize: 31 },
  "6M": { interval: "1day", outputsize: 185 },
  "1Y": { interval: "1day", outputsize: 366 },
  "5Y": { interval: "1week", outputsize: 261 },
  MAX: { interval: "1month", outputsize: 5000 },
};
function toUAH(value, currency = "UAH") {
  return normalizeNumber(value) * (EXCHANGE_RATES[currency] || 1);
}

function rateInfo(currency = 'UAH', date = '', method = 'report-date') {
  const code = String(currency || 'UAH').toUpperCase(), day = String(date || values.getDateString()).slice(0, 10);
  if (code === 'UAH') return { rate: 1, date: day, source: 'UAH', estimated: false, method };
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  if (method === 'operation-date') {
    const source = selectUI('purchaseExchangeRates')?.[code];
    let index = historyIndexes.get(code);
    if (!index || index.source !== source) {
      index = { source, rows: (Array.isArray(source) ? source : []).filter(item => item && validDay(item.date) && Number(item.rate) > 0 && Number.isFinite(Number(item.rate))).slice().sort((a, b) => a.date.localeCompare(b.date)) };
      historyIndexes.set(code, index);
    }
    let low = 0, high = index.rows.length;
    while (low < high) { const middle = (low + high) >>> 1; if (index.rows[middle].date <= day) low = middle + 1; else high = middle; }
    const point = index.rows[low - 1];
    if (point && (Date.parse(day) - Date.parse(point.date)) / 86400000 <= 7)
      return { rate: Number(point.rate), date: point.date, source: 'NBU history', estimated: point.date !== day, method };
    const fallback = Number(HISTORICAL_RATE_FALLBACKS[code]);
    return { rate: fallback > 0 && Number.isFinite(fallback) ? fallback : null, date: null, source: 'Fallback', estimated: true, method };
  }
  const raw = String(selectUI('exchangeRateDate') || ''), parts = raw.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
  const rateDate = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : raw.slice(0, 10);
  const rate = Number(EXCHANGE_RATES[code]);
  const known = validDay(rateDate) && rateDate <= day && selectUI('exchangeRateSource');
  // An undated/next-day live quote is not today's fallback. Prefer a dated
  // official observation already loaded for this report, without another fetch.
  if (!known || selectUI('exchangeRateStale') || (Date.parse(day) - Date.parse(rateDate)) / 86400000 > 7) {
    const historical = rateInfo(code, day, 'operation-date');
    if (historical.source === 'NBU history' && historical.date) return { ...historical, method };
  }
  const datedSource = validDay(rateDate) && selectUI('exchangeRateSource');
  const future = datedSource && rateDate > day;
  return { rate: !future && rate > 0 && Number.isFinite(rate) ? rate : null, date: datedSource ? rateDate : null, source: datedSource ? selectUI('exchangeRateSource') : 'Fallback',
    estimated: !known || Boolean(selectUI('exchangeRateStale')) || (Date.parse(day) - Date.parse(rateDate)) / 86400000 > 7, method };
}
function convertWithInfo(value, currency = 'UAH', date = '', method = 'report-date') {
  const info = rateInfo(currency, date, method), amount = Number(value);
  const converted = info.rate !== null && Number.isFinite(amount) ? amount * info.rate : NaN;
  return { ...info, amount: Number.isFinite(converted) ? converted : null };
}

function getExchangeRateOnDate(currency = "UAH", date = "") {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  if (normalizedCurrency === "UAH") return 1;

  return rateInfo(normalizedCurrency, date, 'operation-date').rate;
}

function toUAHAtDate(value, currency = "UAH", date = "") {
  return normalizeNumber(value) * getExchangeRateOnDate(currency, date);
}

function getAssetPurchaseDate(assetId, fallback = "") {
  const asset = (selectData().assets || []).find((item) => item.id === assetId);
  if (asset?.purchaseDate) return asset.purchaseDate;

  return (selectData().transactions || [])
    .filter((transaction) => transaction.assetId === assetId && transaction.type === "BUY" && contract.isTransactionCompleted(transaction) && transaction.date)
    .map((transaction) => transaction.date)
    .sort()[0] || fallback;
}

function getAssetPurchaseExchangeRate(assetId, currency = "UAH", fallbackDate = "") {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  if (normalizedCurrency === "UAH") return 1;

  const purchases = (selectData().transactions || []).filter(
    (transaction) =>
      transaction.assetId === assetId &&
      transaction.type === "BUY" &&
      contract.isTransactionCompleted(transaction) &&
      String(transaction.currency || normalizedCurrency).toUpperCase() === normalizedCurrency,
  );
  const totals = purchases.reduce((result, transaction) => {
    const amount = normalizeNumber(transaction.amount) ||
      normalizeNumber(transaction.quantity) * normalizeNumber(transaction.purchasePrice ?? transaction.price);
    result.foreign += amount;
    result.uah += toUAHAtDate(amount, normalizedCurrency, transaction.date || fallbackDate);
    return result;
  }, { foreign: 0, uah: 0 });

  return totals.foreign > 0
    ? totals.uah / totals.foreign
    : getExchangeRateOnDate(normalizedCurrency, fallbackDate);
}

function toUAHPurchaseCost(value, currency = "UAH", assetId = "", fallbackDate = "") {
  return normalizeNumber(value) * getAssetPurchaseExchangeRate(assetId, currency, fallbackDate);
}

function convertCurrency(value, fromCurrency = "UAH", toCurrency = "UAH") {
  const targetRate = EXCHANGE_RATES[String(toCurrency || "UAH").toUpperCase()] || 1;
  return toUAH(value, String(fromCurrency || "UAH").toUpperCase()) / targetRate;
}

function marketParamsForRange(range) {
  if (range === "CUSTOM" && getCustomRange()) return { interval: "1day", ...getCustomRange() };
  if (range !== "YTD") return MARKET_RANGE_PARAMS[range] || MARKET_RANGE_PARAMS["1M"];
  const today = new Date();
  return {
    interval: "1day",
    startDate: `${today.getFullYear()}-01-01`,
    endDate: today.toISOString().slice(0, 10),
  };
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function currencyParamsForRange(range) {
  if (range === "CUSTOM" && getCustomRange()) return { ...getCustomRange() };
  const today = new Date().toISOString().slice(0, 10);
  const startDates = {
    "1D": dateDaysAgo(7),
    "5D": dateDaysAgo(10),
    "1M": dateDaysAgo(31),
    "6M": dateDaysAgo(185),
    YTD: `${new Date().getFullYear()}-01-01`,
    "1Y": dateDaysAgo(366),
    "5Y": dateDaysAgo(365 * 5 + 2),
    MAX: "1996-01-01",
  };
  return { startDate: startDates[range] || startDates["1M"], endDate: today };
}

function resolveMarketSymbol(input) {
  const value = String(input || "").trim().toUpperCase();
  if ([".INX", ".DJI", ".IXIC"].includes(value)) return value;
  const holding = (selectData()?.assets || []).find((asset) =>
    [asset.name, asset.ticker, asset.symbol].some((candidate) => String(candidate || "").trim().toUpperCase() === value),
  );
  return String(holding?.underlyingSymbol || value).trim().toUpperCase();
}

function valuesForDates(series, labels) {
  const values = new Map((series || []).map((point) => [point.date, point.value]));
  return labels.map((date) => values.get(date) ?? null);
}
    return { toUAH, rateInfo, convertWithInfo, getExchangeRateOnDate, toUAHAtDate, getAssetPurchaseDate, getAssetPurchaseExchangeRate, toUAHPurchaseCost, convertCurrency, marketParamsForRange, dateDaysAgo, currencyParamsForRange, resolveMarketSymbol, valuesForDates };
  }
  return { createService };
});
