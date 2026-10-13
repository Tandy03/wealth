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
  cacheSeconds: Object.freeze({ twelve: 300, fred: 900, binance: 30, binanceCatalog: 600, inzhur: 900 }),
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
    consumeBudget('requests', 120);
    switch (String(request.action || "")) {
      case "health": return responseOk({ service: "fino-market-proxy", version: 1, time: new Date().toISOString() });
      case "twelve": return responseOk(getTwelveTimeSeries(request));
      case "fred": return responseOk(getFredIndexHistory(request));
      case "binance": return responseOk(getBinanceEquityPrice(request));
      case "binanceCatalog": return responseOk(getBinanceCatalog());
      case "inzhurCatalog": return responseOk(getInzhurCatalog());
      case "macroeconomics": return responseOk(getMacroeconomics());
      case "policyRate": return responseOk(getNbuPolicyRate());
      default: throw apiError("Unknown proxy action.", "UNKNOWN_ACTION", 400);
    }
  } catch (error) {
    const code = /^[A-Z0-9_]{1,60}$/.test(error.code || '') ? error.code : 'PROXY_ERROR';
    console.error(JSON.stringify({ event: 'proxy.failed', code: code, status: Number(error.status) || 500 }));
    return responseError(error.publicMessage ? error.message : 'Proxy request failed.', code, error.status || 500);
  }
}

function getInzhurCatalog() {
  const cacheKey = "inzhur-catalog-v1";
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);
  const fetched = fetchJson("https://www.inzhur.reit/_api/assets", { headers: { Accept: "application/json" } }, "Inzhur");
  if (fetched.status < 200 || fetched.status >= 300 || !Array.isArray(fetched.data)) {
    throw apiError("Could not load the Inzhur asset catalog.", "INZHUR_API_ERROR", fetched.status || 502);
  }
  const result = {
    provider: "Inzhur",
    assets: fetched.data.map(function (asset) {
      const details = asset.assetDetails || {};
      return {
        id: asset.id,
        slug: asset.slug,
        type: asset.type,
        status: asset.status,
        title: asset.title,
        isin: details.isin || null,
        maturityDate: details.maturityDate || null,
        prices: details.prices || null,
        paymentSchedule: details.paymentSchedule || [],
      };
    }),
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, result, CONFIG.cacheSeconds.inzhur);
  return result;
}

function getMacroeconomics() {
  const cacheKey = "macroeconomics-v4";
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear() - 8, 0, 1));
  const dateToken = function (date) {
    return date.getUTCFullYear() + String(date.getUTCMonth() + 1).padStart(2, "0") + String(date.getUTCDate()).padStart(2, "0");
  };
  const nbuBase = "https://bank.gov.ua/NBUStatService/v1/statdirectory";
  const result = {
    updatedAt: new Date().toISOString(),
    sources: { nbu: "NBU", gdp: "State Statistics Service of Ukraine" },
    errors: {},
    exchangeRates: [],
    inflation: { annual: [], monthly: [] },
    gdp: { nominal: [], realIndex: [] },
  };

  try {
    const rates = fetchJson(nbuBase + "/exchange?json", { headers: { Accept: "application/json" } }, "NBU");
    const inflation = fetchJson(nbuBase + "/inflation?period=m&start=" + dateToken(start) + "&end=" + dateToken(now) + "&json", { headers: { Accept: "application/json" } }, "NBU");
    if (rates.status < 200 || rates.status >= 300 || !Array.isArray(rates.data)) throw apiError("NBU exchange rates are unavailable.", "NBU_ERROR", rates.status || 502);
    if (inflation.status < 200 || inflation.status >= 300 || !Array.isArray(inflation.data)) throw apiError("NBU inflation data is unavailable.", "NBU_ERROR", inflation.status || 502);

    const wanted = { USD: true, EUR: true, GBP: true };
    result.exchangeRates = rates.data.filter(function (row) { return wanted[String(row.cc || "").toUpperCase()]; }).map(function (row) {
      return { code: row.cc, name: row.txten || row.txt, rate: Number(row.rate), date: normalizeMacroDate(row.exchangedate) };
    });
    const national = inflation.data.filter(function (row) { return row.mcrd081 === "Total" && (row.ku == null || row.ku === ""); });
    const pick = function (id, measure) {
      return national.filter(function (row) { return row.id_api === id && row.tzep === measure; }).map(macroInflationPoint).filter(validMacroPoint);
    };
    result.inflation.annual = pick("prices_price_cpi_", "PCCM_");
    result.inflation.monthly = pick("prices_price_cpi_", "PCPM_");
  } catch (error) {
    result.errors.nbu = "Could not load NBU data.";
  }

  try {
    const gdpUrl = "https://stat.gov.ua/sdmx/workspaces/default:integration/registry/sdmx/3.0/data/dataflow/SSSU/DF_ANNUAL_NATIONAL_ACCOUNTS/latest/*?startPeriod=2010";
    consumeBudget('upstream', 120);
    const response = UrlFetchApp.fetch(gdpUrl, { muteHttpExceptions: true, followRedirects: true, headers: { Accept: "text/csv" } });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw apiError("State Statistics Service returned " + response.getResponseCode() + ".", "SSSU_ERROR", response.getResponseCode());
    const rows = parseMacroCsv(response.getContentText().replace(/^\uFEFF/, ""));
    const headers = rows.shift() || [];
    const objects = rows.map(function (values) { const item = {}; headers.forEach(function (key, index) { item[key] = values[index]; }); return item; });
    const select = function (priceType) {
      return objects.filter(function (row) {
        return row.INDICATOR === "GDP_CUR_PRC" && row.PRICE_TYPE === priceType && row.REGION === "UA00000000000000000" && row.BREAKDOWN_CATEGORY === "_T" && row.BREAKDOWN === "_T" && row.SECTOR_ECONOMY === "S_1" && row.FREQ === "A";
      }).map(function (row) { return { date: row.TIME_PERIOD, value: Number(row.OBS_VALUE) }; }).filter(validMacroPoint);
    };
    result.gdp.nominal = select("CURR_PRICES");
    result.gdp.realIndex = select("IDX_VOL_PY");
  } catch (error) {
    result.errors.gdp = "Could not load GDP data.";
  }

  writeCache(cacheKey, result, 21600);
  return result;
}

function getNbuPolicyRate() {
  const cacheKey = "policy-rate-v2";
  const cached = readCache(cacheKey);
  if (cached) return withCached(cached);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear() - 3, 0, 1));
  const token = function (date) { return date.getUTCFullYear() + String(date.getUTCMonth() + 1).padStart(2, "0") + String(date.getUTCDate()).padStart(2, "0"); };
  const response = fetchJson("https://bank.gov.ua/NBUStatService/v1/statdirectory/key?period=d&start=" + token(start) + "&end=" + token(now) + "&json", { headers: { Accept: "application/json" } }, "NBU");
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) throw apiError("NBU policy-rate data is unavailable.", "NBU_ERROR", response.status || 502);
  const result = { policyRate: response.data.filter(function (row) { return row.id_api === "KEY_PolicyRate"; }).map(function (row) {
    return { date: normalizeMacroDate(row.dt), value: Number(row.value) };
  }).filter(validMacroPoint).sort(function (a, b) { return a.date.localeCompare(b.date); }) };
  writeCache(cacheKey, result, 21600);
  return result;
}

function normalizeMacroDate(value) {
  const text = String(value || "");
  if (/^\d{8}$/.test(text)) return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
  const match = text.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  return match ? match[3] + "-" + match[2] + "-" + match[1] : text.slice(0, 10);
}

function macroInflationPoint(row) {
  let value = Number(row.value);
  if (String(row.dt || "").indexOf("201907") === 0 && value <= -90) value += 100;
  return { date: normalizeMacroDate(row.dt), value: value };
}

function validMacroPoint(point) { return Boolean(point && point.date && isFinite(Number(point.value))); }

function parseMacroCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i += 1; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseRequest(event) {
  if (!event || !event.postData || !event.postData.contents) throw apiError("A JSON request body is required.", "INVALID_BODY", 400);
  if (event.postData.contents.length > 2 * 1024 * 1024) throw apiError('Request body is too large.', 'INVALID_BODY', 413);
  let body;
  try { body = JSON.parse(event.postData.contents); }
  catch (_) { throw apiError("The request body must be valid JSON.", "INVALID_JSON", 400); }
  if (!body || Object.prototype.toString.call(body) !== "[object Object]") throw apiError("The request body must be an object.", "INVALID_BODY", 400);
  validateJsonTree(body);
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
  const outputsize = request.outputsize == null ? 365 : Number(request.outputsize);
  if (!Number.isInteger(outputsize) || outputsize < 1 || outputsize > CONFIG.maxOutputSize) throw apiError('Invalid output size.', 'INVALID_OUTPUT_SIZE', 400);
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
  if (fetched.status < 200 || fetched.status >= 300 || (payload && payload.status === "error")) throw apiError("Twelve Data request failed.", "TWELVE_DATA_ERROR", fetched.status || 502);
  if (!payload || !Array.isArray(payload.values)) throw apiError("Twelve Data returned no price history for this symbol.", "TIME_SERIES_NOT_FOUND", 404);

  const result = {
    provider: "Twelve Data",
    meta: payload.meta || { symbol: symbol, interval: interval },
    values: payload.values.map(function (point) {
      return { datetime: point.datetime, open: numeric(point.open), high: numeric(point.high), low: numeric(point.low), close: numeric(point.close), volume: point.volume == null ? null : numeric(point.volume) };
    }).filter(function (point) { return ['open', 'high', 'low', 'close'].every(function (field) { return point[field] != null && isFinite(point[field]) && point[field] > 0; }); }),
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
  if (fetched.status < 200 || fetched.status >= 300 || (fetched.data && fetched.data.error_code)) throw apiError("FRED request failed.", "FRED_API_ERROR", fetched.status || 502);
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
  consumeBudget('upstream', 120);
  const response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true, followRedirects: true }, options || {}));
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (text.length > 5 * 1024 * 1024) throw apiError('Provider response is too large.', 'UPSTREAM_TOO_LARGE', 502);
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch (_) { throw apiError(provider + " returned an invalid response.", "UPSTREAM_INVALID_JSON", 502); }
  validateJsonTree(data);
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
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + "T00:00:00Z").getTime()) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw apiError(name + " must be a valid date.", "INVALID_DATE", 400);
  return date;
}

function optionalDateTime(value, name) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text) || isNaN(new Date(text.replace(" ", "T")).getTime())) throw apiError(name + " must be a valid date.", "INVALID_DATE", 400);
  requiredDate(text.slice(0, 10), name);
  if (text.length > 10 && (Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || Number(text.slice(17, 19) || 0) > 59)) throw apiError('Invalid clock time.', 'INVALID_DATE', 400);
  return text;
}

function numeric(value) { const number = Number(value); return isFinite(number) ? number : null; }
function encodeQuery(values) { return Object.keys(values).filter(function (key) { return values[key] != null; }).map(function (key) { return encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key])); }).join("&"); }
function cacheKeyFor(prefix, values) { const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, prefix + ":" + JSON.stringify(values)); return prefix + "-" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, ""); }
function readCache(key) { const value = CacheService.getScriptCache().get(key); if (!value) return null; try { return JSON.parse(value); } catch (_) { return null; } }
function writeCache(key, value, seconds) { const serialized = JSON.stringify(value); if (serialized.length <= CONFIG.cacheLimitBytes) CacheService.getScriptCache().put(key, serialized, seconds); }
function withCached(value) { const copy = JSON.parse(JSON.stringify(value)); copy.cached = true; return copy; }
function apiError(message, code, status) { const error = new Error(message); error.code = code; error.status = status; error.publicMessage = true; return error; }

function validateJsonTree(value, depth) {
  depth = depth || 0;
  if (depth > 64) throw apiError('JSON nesting is too deep.', 'INVALID_DATA', 400);
  if (typeof value === 'number' && !isFinite(value)) throw apiError('Nonfinite JSON number.', 'INVALID_DATA', 400);
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function (key) {
    if (['__proto__', 'prototype', 'constructor'].indexOf(key) !== -1) throw apiError('Unsafe JSON property.', 'INVALID_DATA', 400);
    validateJsonTree(value[key], depth + 1);
  });
}

function consumeBudget(group, limit) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw apiError('Proxy is busy. Retry later.', 'PROXY_RATE_LIMITED', 429);
  try {
    const properties = PropertiesService.getScriptProperties(), key = 'FINO_BUDGET_' + group.toUpperCase(), minute = Math.floor(Date.now() / 60000);
    let saved = null;
    try { saved = JSON.parse(properties.getProperty(key) || 'null'); } catch (_) {}
    const count = saved && saved.minute === minute ? Number(saved.count) : 0;
    if (count >= limit) throw apiError('Proxy request limit reached.', 'PROXY_RATE_LIMITED', 429);
    properties.setProperty(key, JSON.stringify({ minute: minute, count: count + 1 }));
  } finally { lock.releaseLock(); }
}
function responseOk(data) { return jsonOutput({ ok: true, data: data }); }
function responseError(message, code, status) { return jsonOutput({ ok: false, error: { message: message, code: code, status: status } }); }
function jsonOutput(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
