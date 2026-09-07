/**
 * Fino market-data proxy for Google Apps Script.
 * Required Script Properties:
 *   FINO_PROXY_TOKEN, TWELVE_DATA_API_KEY, FRED_API_KEY, BINANCE_API_KEY
 */

const CONFIG = Object.freeze({
  twelveBaseUrl: "https://api.twelvedata.com",
  fredBaseUrl: "https://api.stlouisfed.org",
  binanceBaseUrl: "https://api.binance.com",
  maxOutputSize: 5000,
  cacheLimitBytes: 90000,
  cacheSeconds: Object.freeze({ twelve: 300, fred: 900, binance: 30, binanceCatalog: 600 }),
});

const ALLOWED_INTERVALS = Object.freeze([
  "1min", "5min", "15min", "30min", "45min", "1h",
  "2h", "4h", "8h", "1day", "1week", "1month",
]);

const FRED_INDICES = Object.freeze({
  ".INX": Object.freeze({ seriesId: "SP500", name: "S&P 500", exchange: "S&P 500 Index" }),
  ".DJI": Object.freeze({ seriesId: "DJIA", name: "Dow Jones Industrial Average", exchange: "Dow Jones Industrial Average" }),
  ".IXIC": Object.freeze({ seriesId: "NASDAQCOM", name: "NASDAQ Composite", exchange: "NASDAQ Composite Index" }),
});

function doGet(event) {
  const action = String((event && event.parameter && event.parameter.action) || "health");
  if (action !== "health") return responseError("Use POST for market-data requests.", "METHOD_NOT_ALLOWED", 405);
  return responseOk({ service: "fino-market-proxy", version: 1, time: new Date().toISOString() });
}

function doPost(event) {
  try {
    const request = parseRequest(event);
    authorize(request.token);
    switch (String(request.action || "")) {
      case "health": return responseOk({ service: "fino-market-proxy", version: 1, time: new Date().toISOString() });
      case "twelve": return responseOk(getTwelveTimeSeries(request));
      case "fred": return responseOk(getFredIndexHistory(request));
      case "binance": return responseOk(getBinanceEquityPrice(request));
      case "binanceCatalog": return responseOk(getBinanceCatalog());
      default: throw apiError("Unknown proxy action.", "UNKNOWN_ACTION", 400);
    }
  } catch (error) {
    console.error(String(error && error.stack || error));
    return responseError(error.message || "Proxy request failed.", error.code || "PROXY_ERROR", error.status || 500);
  }
}

function parseRequest(event) {
  if (!event || !event.postData || !event.postData.contents) throw apiError("A JSON request body is required.", "INVALID_BODY", 400);
  let body;
  try { body = JSON.parse(event.postData.contents); }
  catch (_) { throw apiError("The request body must be valid JSON.", "INVALID_JSON", 400); }
  if (!body || Object.prototype.toString.call(body) !== "[object Object]") throw apiError("The request body must be an object.", "INVALID_BODY", 400);
  return body;
}

function authorize(providedToken) {
  const expectedToken = requiredProperty("FINO_PROXY_TOKEN");
  if (!providedToken || String(providedToken) !== expectedToken) throw apiError("Unauthorized.", "UNAUTHORIZED", 401);
}

function getTwelveTimeSeries(request) {
  const symbol = validateSymbol(request.symbol);
  const interval = String(request.interval || "1day");
  if (ALLOWED_INTERVALS.indexOf(interval) === -1) throw apiError("Unsupported time-series interval.", "INVALID_INTERVAL", 400);
  const outputsize = Math.min(CONFIG.maxOutputSize, Math.max(1, Math.floor(Number(request.outputsize) || 365)));
  const startDate = optionalDateTime(request.startDate, "startDate");
  const endDate = optionalDateTime(request.endDate, "endDate");
  if (startDate && endDate && startDate > endDate) throw apiError("startDate cannot be later than endDate.", "INVALID_DATE", 400);
  const cacheKey = cacheKeyFor("twelve", [symbol, interval, outputsize, startDate, endDate]);
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);

  const query = {
    symbol: symbol, interval: interval, order: "asc", format: "JSON",
    apikey: requiredProperty("TWELVE_DATA_API_KEY"),
  };
  if (startDate) query.start_date = startDate;
  if (endDate) query.end_date = endDate;
  if (!startDate || !endDate) query.outputsize = outputsize;
  const fetched = fetchJson(CONFIG.twelveBaseUrl + "/time_series?" + encodeQuery(query), { headers: { Accept: "application/json" } }, "Twelve Data");
  const payload = fetched.data;
  if (fetched.status === 429 || Number(payload && payload.code) === 429) throw apiError("Twelve Data request limit reached. Try again later.", "TWELVE_DATA_RATE_LIMITED", 429);
  if (fetched.status < 200 || fetched.status >= 300 || (payload && payload.status === "error")) throw apiError((payload && payload.message) || "Twelve Data request failed.", "TWELVE_DATA_ERROR", fetched.status || 502);
  if (!payload || !Array.isArray(payload.values)) throw apiError("Twelve Data returned no price history for this symbol.", "TIME_SERIES_NOT_FOUND", 404);

  const result = {
    provider: "Twelve Data",
    meta: payload.meta || { symbol: symbol, interval: interval },
    values: payload.values.map(function (point) {
      return { datetime: point.datetime, open: numeric(point.open), high: numeric(point.high), low: numeric(point.low), close: numeric(point.close), volume: point.volume == null ? null : numeric(point.volume) };
    }),
    cached: false, fetchedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, result, CONFIG.cacheSeconds.twelve);
  return result;
}

function getFredIndexHistory(request) {
  const symbol = String(request.symbol || ".INX").trim().toUpperCase();
  const index = FRED_INDICES[symbol];
  if (!index) throw apiError("This FRED index is not supported.", "UNSUPPORTED_INDEX", 400);
  const startDate = requiredDate(request.startDate, "startDate");
  const endDate = requiredDate(request.endDate, "endDate");
  if (startDate > endDate) throw apiError("startDate cannot be later than endDate.", "INVALID_DATE", 400);
  const cacheKey = cacheKeyFor("fred", [symbol, startDate, endDate]);
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);

  const url = CONFIG.fredBaseUrl + "/fred/series/observations?" + encodeQuery({
    series_id: index.seriesId, api_key: requiredProperty("FRED_API_KEY"), file_type: "json",
    observation_start: startDate, observation_end: endDate, sort_order: "asc",
  });
  const fetched = fetchJson(url, { headers: { Accept: "application/json" } }, "FRED");
  if (fetched.status === 429) throw apiError("FRED API request limit reached. Try again later.", "FRED_RATE_LIMITED", 429);
  if (fetched.status < 200 || fetched.status >= 300 || (fetched.data && fetched.data.error_code)) throw apiError((fetched.data && fetched.data.error_message) || "FRED request failed.", "FRED_API_ERROR", fetched.status || 502);
  const observations = Array.isArray(fetched.data && fetched.data.observations)
    ? fetched.data.observations.filter(function (item) { return item && item.value !== "." && isFinite(Number(item.value)); }) : [];
  if (!observations.length) throw apiError("FRED returned no " + index.name + " history for this period.", "INDEX_HISTORY_NOT_FOUND", 404);
  const result = {
    provider: "FRED",
    meta: { symbol: symbol, name: index.name, providerSymbol: index.seriesId, currency: "USD", interval: "1day", type: "Index", exchange: index.exchange },
    values: observations.map(function (item) { const close = Number(item.value); return { datetime: item.date, open: close, high: close, low: close, close: close, volume: null }; }),
    cached: false, fetchedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, result, CONFIG.cacheSeconds.fred);
  return result;
}

function getBinanceCatalog() {
  const cacheKey = "binance-catalog-v1";
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);
  const headers = { Accept: "application/json", "X-MBX-APIKEY": requiredProperty("BINANCE_API_KEY") };
  const exchange = fetchJson(CONFIG.binanceBaseUrl + "/sapi/v1/equity/market/exchangeInfo", { headers: headers }, "Binance");
  const assets = fetchJson(CONFIG.binanceBaseUrl + "/sapi/v1/equity/market/tokenized-assets", { headers: headers }, "Binance");
  if (exchange.status < 200 || exchange.status >= 300 || assets.status < 200 || assets.status >= 300) throw apiError("Unable to retrieve Binance equity catalog.", "BINANCE_API_ERROR", Math.max(exchange.status, assets.status));
  if (!exchange.data || !Array.isArray(exchange.data.symbols) || !Array.isArray(assets.data)) throw apiError("Binance returned invalid equity market data.", "BINANCE_API_ERROR", 502);
  const result = { provider: "Binance Stocks", timezone: exchange.data.timezone || "UTC", symbols: exchange.data.symbols, tokenizedAssets: assets.data, cached: false, fetchedAt: new Date().toISOString() };
  writeCache(cacheKey, result, CONFIG.cacheSeconds.binanceCatalog);
  return result;
}

function getBinanceEquityPrice(request) {
  const assetCode = validateSymbol(request.symbol || request.assetCode);
  const cacheKey = cacheKeyFor("binance", [assetCode]);
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);
  const catalog = getBinanceCatalog();
  const tokenized = catalog.tokenizedAssets.find(function (item) { return String(item.assetCode || "").toUpperCase() === assetCode; });
  const underlyingSymbol = String((tokenized && tokenized.underlyingEquitySymbol) || assetCode).toUpperCase();
  const exchangeInfo = catalog.symbols.find(function (item) { return String(item.symbol || "").toUpperCase() === underlyingSymbol; });
  if (!exchangeInfo) throw apiError(assetCode + " is not available in Binance equity market data.", "EQUITY_NOT_FOUND", 404);
  const fetched = fetchJson(CONFIG.binanceBaseUrl + "/sapi/v1/equity/market/quote?" + encodeQuery({ symbol: underlyingSymbol }), { headers: { Accept: "application/json", "X-MBX-APIKEY": requiredProperty("BINANCE_API_KEY") } }, "Binance");
  if (fetched.status === 418 || fetched.status === 429) throw apiError("Binance rate limit reached.", "BINANCE_RATE_LIMITED", 429);
  if (fetched.status < 200 || fetched.status >= 300 || !fetched.data) throw apiError("No current quote is available for " + underlyingSymbol + ".", "QUOTE_NOT_AVAILABLE", 404);
  const bid = Number(fetched.data.bidPrice), ask = Number(fetched.data.askPrice);
  const underlyingPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : (bid > 0 ? bid : ask);
  const multiplier = tokenized && Number(tokenized.multiplier) > 0 ? Number(tokenized.multiplier) : 1;
  if (!(underlyingPrice > 0)) throw apiError("No usable quote is available for " + underlyingSymbol + ".", "QUOTE_NOT_AVAILABLE", 404);
  const result = { provider: "Binance Stocks", assetCode: assetCode, underlyingSymbol: underlyingSymbol, currentPrice: underlyingPrice * multiplier, bidPrice: bid || null, askPrice: ask || null, multiplier: multiplier, tradability: exchangeInfo.tradability, quoteCurrency: "USD", cached: false, fetchedAt: new Date().toISOString() };
  writeCache(cacheKey, result, CONFIG.cacheSeconds.binance);
  return result;
}

function fetchJson(url, options, provider) {
  const response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true, followRedirects: true }, options || {}));
  const status = response.getResponseCode();
  const text = response.getContentText();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch (_) { throw apiError(provider + " returned an invalid response.", "UPSTREAM_INVALID_JSON", 502); }
  return { status: status, data: data };
}

function requiredProperty(name) {
  const value = String(PropertiesService.getScriptProperties().getProperty(name) || "").trim();
  if (!value) throw apiError(name + " is not configured.", "NOT_CONFIGURED", 503);
  return value;
}

function validateSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9./:-]{1,30}$/.test(symbol)) throw apiError("A valid market symbol is required.", "INVALID_SYMBOL", 400);
  return symbol;
}

function requiredDate(value, name) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + "T00:00:00Z").getTime())) throw apiError(name + " must be a valid date.", "INVALID_DATE", 400);
  return date;
}

function optionalDateTime(value, name) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text) || isNaN(new Date(text.replace(" ", "T")).getTime())) throw apiError(name + " must be a valid date.", "INVALID_DATE", 400);
  return text;
}

function numeric(value) { const number = Number(value); return isFinite(number) ? number : null; }
function encodeQuery(values) { return Object.keys(values).filter(function (key) { return values[key] != null; }).map(function (key) { return encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key])); }).join("&"); }
function cacheKeyFor(prefix, values) { const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, prefix + ":" + JSON.stringify(values)); return prefix + "-" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, ""); }
function readCache(key) { const value = CacheService.getScriptCache().get(key); if (!value) return null; try { return JSON.parse(value); } catch (_) { return null; } }
function writeCache(key, value, seconds) { const serialized = JSON.stringify(value); if (serialized.length <= CONFIG.cacheLimitBytes) CacheService.getScriptCache().put(key, serialized, seconds); }
function withCached(value) { const copy = JSON.parse(JSON.stringify(value)); copy.cached = true; return copy; }
function apiError(message, code, status) { const error = new Error(message); error.code = code; error.status = status; return error; }
function responseOk(data) { return jsonOutput({ ok: true, data: data }); }
function responseError(message, code, status) { return jsonOutput({ ok: false, error: { message: message, code: code, status: status } }); }
function jsonOutput(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

