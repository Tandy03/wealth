const { providerFetch } = require('../market/fetch');
const FRANKFURTER_BASE_URL = process.env.FRANKFURTER_BASE_URL || "https://api.frankfurter.dev";
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

class FrankfurterError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function validDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new FrankfurterError("A valid date is required.", 400);
  }
  return date;
}

async function getExchangeHistory({ ticker = "USEU", startDate, endDate }) {
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  const pairs = {
    USEU: { base: "USD", quote: "EUR" },
    EUUS: { base: "EUR", quote: "USD" },
  };
  const pair = pairs[normalizedTicker];
  if (!pair) throw new FrankfurterError("Unsupported Frankfurter market ticker.", 400);
  const start = validDate(startDate);
  const end = validDate(endDate);
  if (start > end) throw new FrankfurterError("startDate cannot be later than endDate.", 400);
  const cacheKey = `${normalizedTicker}:${start}:${end}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return { ...cached.data, cached: true };

  const url = new URL("/v2/rates", FRANKFURTER_BASE_URL);
  url.searchParams.set("base", pair.base);
  url.searchParams.set("quotes", pair.quote);
  url.searchParams.set("from", start);
  url.searchParams.set("to", end);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await providerFetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new FrankfurterError(payload?.message || `Frankfurter API returned ${response.status}.`, response.status);
    if (!Array.isArray(payload)) throw new FrankfurterError("Frankfurter returned invalid exchange-rate history.");
    const values = payload
      .filter((item) => item.base === pair.base && item.quote === pair.quote && Number.isFinite(Number(item.rate)))
      .map((item) => ({ datetime: item.date, open: Number(item.rate), high: Number(item.rate), low: Number(item.rate), close: Number(item.rate), volume: null }))
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
    if (!values.length) throw new FrankfurterError(`No ${pair.base}/${pair.quote} rates were found for this period.`, 404);
    const data = {
      provider: "Frankfurter",
      meta: { symbol: `${pair.base}/${pair.quote}`, currency: pair.quote, interval: "1day", type: "Exchange rate", exchange: "Frankfurter", marketTicker: normalizedTicker },
      values,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { updatedAt: Date.now(), data });
    return data;
  } catch (error) {
    if (error instanceof FrankfurterError) throw error;
    if (error?.name === "AbortError") throw new FrankfurterError("Frankfurter request timed out.", 504);
    throw new FrankfurterError(`Could not load ${pair.base}/${pair.quote} history from Frankfurter.`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { FrankfurterError, getExchangeHistory };
