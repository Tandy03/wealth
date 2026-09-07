const NBU_HISTORY_URL = process.env.NBU_HISTORY_URL || "https://bank.gov.ua/NBU_Exchange/exchange_site";
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

class NbuExchangeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function isoDate(value, fallback) {
  const date = String(value || fallback || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new NbuExchangeError("A valid date is required.", 400);
  }
  return date;
}

function compactDate(value) {
  return value.replaceAll("-", "");
}

function nbuDateToIso(value) {
  const [day, month, year] = String(value || "").split(".");
  return year && month && day ? `${year}-${month}-${day}` : String(value || "");
}

async function getNbuCurrencyHistory({ code, startDate, endDate }) {
  const currency = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "UAH") throw new NbuExchangeError("A valid foreign currency code is required.", 400);
  const today = new Date().toISOString().slice(0, 10);
  const end = isoDate(endDate, today);
  const start = isoDate(startDate, `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`);
  if (start > end) throw new NbuExchangeError("startDate cannot be later than endDate.", 400);

  const cacheKey = `${currency}:${start}:${end}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) return { ...cached.data, cached: true };

  const url = new URL(NBU_HISTORY_URL);
  url.searchParams.set("start", compactDate(start));
  url.searchParams.set("end", compactDate(end));
  url.searchParams.set("valcode", currency);
  url.searchParams.set("sort", "exchangedate");
  url.searchParams.set("order", "asc");
  url.searchParams.set("json", "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Wealth-Dashboard/1.0" }, signal: controller.signal });
    if (!response.ok) throw new NbuExchangeError(`NBU API returned ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length) throw new NbuExchangeError(`No NBU rates found for ${currency}.`, 404);
    const values = payload.map((item) => ({
      datetime: nbuDateToIso(item.exchangedate),
      open: Number(item.rate_per_unit ?? item.rate),
      high: Number(item.rate_per_unit ?? item.rate),
      low: Number(item.rate_per_unit ?? item.rate),
      close: Number(item.rate_per_unit ?? item.rate),
      volume: null,
    })).filter((item) => item.datetime && Number.isFinite(item.close));
    const data = {
      provider: "NBU",
      meta: { symbol: `${currency}/UAH`, currency: "UAH", interval: "1day", type: "Official exchange rate", exchange: "NBU", currencyCode: currency },
      values,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { updatedAt: Date.now(), data });
    return data;
  } catch (error) {
    if (error instanceof NbuExchangeError) throw error;
    if (error?.name === "AbortError") throw new NbuExchangeError("NBU request timed out.", 504);
    throw new NbuExchangeError("Could not load currency history from the NBU.");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { NbuExchangeError, getNbuCurrencyHistory };
