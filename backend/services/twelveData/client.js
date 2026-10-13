const { providerFetch } = require('../market/fetch');
const TWELVE_DATA_BASE_URL = process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_INTERVALS = new Set(["1min", "5min", "15min", "30min", "45min", "1h", "2h", "4h", "8h", "1day", "1week", "1month"]);
const cache = new Map();

class TwelveDataError extends Error {
  constructor(message, code = "TWELVE_DATA_ERROR", status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function validateSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9./:-]{1,30}$/.test(symbol)) {
    throw new TwelveDataError("A valid market symbol is required.", "INVALID_SYMBOL", 400);
  }
  return symbol;
}

function validateDate(value, name) {
  if (value === undefined || value === "") return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new TwelveDataError(`${name} must be a valid date.`, "INVALID_DATE", 400);
  }
  return date;
}

async function getTimeSeries(options = {}) {
  const apiKey = String(process.env.TWELVE_DATA_API_KEY || "").trim();
  if (!apiKey) throw new TwelveDataError("TWELVE_DATA_API_KEY is not configured.", "TWELVE_DATA_NOT_CONFIGURED", 503);

  const symbol = validateSymbol(options.symbol);
  const interval = String(options.interval || "1day");
  if (!ALLOWED_INTERVALS.has(interval)) {
    throw new TwelveDataError("Unsupported time-series interval.", "INVALID_INTERVAL", 400);
  }

  const outputsize = Math.min(5000, Math.max(1, Math.trunc(Number(options.outputsize) || 365)));
  const startDate = validateDate(options.startDate, "startDate");
  const endDate = validateDate(options.endDate, "endDate");
  const cacheKey = JSON.stringify({ symbol, interval, outputsize, startDate, endDate });
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return { ...cached.data, cached: true };

  const url = new URL("/time_series", TWELVE_DATA_BASE_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("order", "asc");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", apiKey);
  if (startDate) url.searchParams.set("start_date", startDate);
  if (endDate) url.searchParams.set("end_date", endDate);
  if (!startDate || !endDate) url.searchParams.set("outputsize", String(outputsize));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await providerFetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (response.status === 429 || payload?.code === 429) {
      throw new TwelveDataError("Twelve Data request limit reached. Try again later.", "TWELVE_DATA_RATE_LIMITED", 429);
    }
    if (!response.ok || payload?.status === "error") {
      throw new TwelveDataError("Twelve Data request failed.", "TWELVE_DATA_ERROR", response.status >= 400 ? response.status : 502);
    }
    if (!Array.isArray(payload?.values)) {
      throw new TwelveDataError("Twelve Data returned no price history for this symbol.", "TIME_SERIES_NOT_FOUND", 404);
    }

    const data = {
      provider: "Twelve Data",
      meta: payload.meta || { symbol, interval },
      values: payload.values.map((point) => ({
        datetime: point.datetime,
        open: Number(point.open),
        high: Number(point.high),
        low: Number(point.low),
        close: Number(point.close),
        volume: point.volume === undefined ? null : Number(point.volume),
      })),
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    const validated = require('../../../frontend/js/market-model').history(data);
    data.values = validated.values;
    cache.set(cacheKey, { updatedAt: Date.now(), data });
    return data;
  } catch (error) {
    if (error instanceof TwelveDataError) throw error;
    if (error?.name === "AbortError") throw new TwelveDataError("Twelve Data request timed out.", "TWELVE_DATA_TIMEOUT", 504);
    throw new TwelveDataError("Could not connect to Twelve Data.");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { ALLOWED_INTERVALS, TwelveDataError, getTimeSeries };
