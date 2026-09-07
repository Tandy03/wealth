const FRED_BASE_URL = process.env.FRED_BASE_URL || "https://api.stlouisfed.org";
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();
const INDEX_SERIES = Object.freeze({
  ".INX": { seriesId: "SP500", name: "S&P 500", exchange: "S&P 500 Index" },
  ".DJI": { seriesId: "DJIA", name: "Dow Jones Industrial Average", exchange: "Dow Jones Industrial Average" },
  ".IXIC": { seriesId: "NASDAQCOM", name: "NASDAQ Composite", exchange: "NASDAQ Composite Index" },
});

class FredApiError extends Error {
  constructor(message, code = "FRED_API_ERROR", status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function validateDate(value, name) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new FredApiError(`${name} must be a valid date.`, "INVALID_DATE", 400);
  }
  return date;
}

async function getIndexHistory({ symbol, startDate, endDate }) {
  const apiKey = String(process.env.FRED_API_KEY || "").trim();
  if (!apiKey) throw new FredApiError("FRED_API_KEY is not configured.", "FRED_NOT_CONFIGURED", 503);
  const start = validateDate(startDate, "startDate");
  const end = validateDate(endDate, "endDate");
  if (start > end) throw new FredApiError("startDate cannot be later than endDate.", "INVALID_DATE", 400);
  const requestedSymbol = String(symbol || ".INX").trim().toUpperCase();
  const index = INDEX_SERIES[requestedSymbol];
  if (!index) throw new FredApiError("This FRED index is not supported.", "UNSUPPORTED_INDEX", 400);

  const cacheKey = `${requestedSymbol}:${start}:${end}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return { ...cached.data, cached: true };

  const url = new URL("/fred/series/observations", FRED_BASE_URL);
  url.searchParams.set("series_id", index.seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start);
  url.searchParams.set("observation_end", end);
  url.searchParams.set("sort_order", "asc");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (response.status === 429) throw new FredApiError("FRED API request limit reached. Try again later.", "FRED_RATE_LIMITED", 429);
    if (!response.ok || payload?.error_code) {
      throw new FredApiError(payload?.error_message || "FRED request failed.", "FRED_API_ERROR", response.status >= 400 ? response.status : 502);
    }

    const observations = Array.isArray(payload?.observations)
      ? payload.observations.filter((item) => item?.value !== "." && Number.isFinite(Number(item?.value)))
      : [];
    if (!observations.length) {
      throw new FredApiError(`FRED returned no ${index.name} history for this period.`, "INDEX_HISTORY_NOT_FOUND", 404);
    }

    const data = {
      provider: "FRED",
      meta: { symbol: requestedSymbol, name: index.name, providerSymbol: index.seriesId, currency: "USD", interval: "1day", type: "Index", exchange: index.exchange },
      values: observations.map((observation) => {
        const close = Number(observation.value);
        return { datetime: observation.date, open: close, high: close, low: close, close, volume: null };
      }),
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { updatedAt: Date.now(), data });
    return data;
  } catch (error) {
    if (error instanceof FredApiError) throw error;
    if (error?.name === "AbortError") throw new FredApiError("FRED request timed out.", "FRED_TIMEOUT", 504);
    throw new FredApiError("Could not connect to FRED.");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { FredApiError, getIndexHistory };
