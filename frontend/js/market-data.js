(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoMarketData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ state, exchangeRates, historicalRates, values, getCustomRange = () => null }) {
    const { normalizeNumber } = values;
    const EXCHANGE_RATES = exchangeRates;
    const HISTORICAL_RATE_FALLBACKS = historicalRates;
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

function getExchangeRateOnDate(currency = "UAH", date = "") {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  if (normalizedCurrency === "UAH") return 1;

  const rates = state.purchaseExchangeRates[normalizedCurrency] || [];
  const normalizedDate = String(date || "").slice(0, 10);
  if (!normalizedDate || !rates.length) return HISTORICAL_RATE_FALLBACKS[normalizedCurrency] || 1;

  const rate = [...rates].reverse().find((item) => item.date <= normalizedDate) || rates[0];
  return normalizeNumber(rate?.rate) || HISTORICAL_RATE_FALLBACKS[normalizedCurrency] || 1;
}

function toUAHAtDate(value, currency = "UAH", date = "") {
  return normalizeNumber(value) * getExchangeRateOnDate(currency, date);
}

function getAssetPurchaseDate(assetId, fallback = "") {
  const asset = (state.data.assets || []).find((item) => item.id === assetId);
  if (asset?.purchaseDate) return asset.purchaseDate;

  return (state.data.transactions || [])
    .filter((transaction) => transaction.assetId === assetId && transaction.type === "BUY" && transaction.date)
    .map((transaction) => transaction.date)
    .sort()[0] || fallback;
}

function getAssetPurchaseExchangeRate(assetId, currency = "UAH", fallbackDate = "") {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  if (normalizedCurrency === "UAH") return 1;

  const purchases = (state.data.transactions || []).filter(
    (transaction) =>
      transaction.assetId === assetId &&
      transaction.type === "BUY" &&
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
  const holding = (state.data?.assets || []).find((asset) =>
    [asset.name, asset.ticker, asset.symbol].some((candidate) => String(candidate || "").trim().toUpperCase() === value),
  );
  return String(holding?.underlyingSymbol || value).trim().toUpperCase();
}

function valuesForDates(series, labels) {
  const values = new Map((series || []).map((point) => [point.date, point.value]));
  return labels.map((date) => values.get(date) ?? null);
}
    return { toUAH, getExchangeRateOnDate, toUAHAtDate, getAssetPurchaseDate, getAssetPurchaseExchangeRate, toUAHPurchaseCost, convertCurrency, marketParamsForRange, dateDaysAgo, currencyParamsForRange, resolveMarketSymbol, valuesForDates };
  }
  return { createService };
});
