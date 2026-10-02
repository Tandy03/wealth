const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

test("market routes delegate to providers and preserve cached and failure responses", async (t) => {
  const timeSeries = require("../services/twelveData/client");
  const fred = require("../services/fred/indices");
  const nbu = require("../services/nbu/exchangeHistory");
  const frankfurter = require("../services/frankfurter/exchangeHistory");
  const macro = require("../services/macroeconomics/client");
  let providerFailure = false;
  t.mock.method(timeSeries, "getTimeSeries", async (params) => {
    if (providerFailure) throw Object.assign(new Error("Quota reached"), { status: 429, code: "TWELVE_DATA_RATE_LIMITED" });
    return { provider: "Twelve Data", meta: params, values: [] };
  });
  t.mock.method(fred, "getIndexHistory", async (params) => ({ provider: "FRED", meta: params, values: [] }));
  t.mock.method(nbu, "getNbuCurrencyHistory", async (params) => ({ provider: "NBU", meta: params, values: [] }));
  t.mock.method(frankfurter, "getExchangeHistory", async (params) => ({ provider: "Frankfurter", meta: params, values: [] }));
  t.mock.method(macro, "getMacroeconomics", async () => ({ inflation: { annual: [] } }));
  t.mock.method(macro, "getPolicyRate", async () => [{ date: "2026-01-01", value: 15 }]);
  const { createApp } = require("../app");
  const { createRepository } = require("../data/repository");
  const repository = createRepository({ drive: { isEnabled: () => false } });
  const server = createApp({ repository }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const realFetch = global.fetch;
  let nbuFailure = false;
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(global, "fetch", async (url, options) => {
    if (String(url).startsWith(base)) return realFetch(url, options);
    if (String(url).includes("bank.gov.ua")) {
      if (nbuFailure) throw new Error("mock NBU offline");
      return { ok: true, json: async () => [{ cc: "USD", rate: 40, txt: "US Dollar", exchangedate: "01.01.2026" }, { cc: "EUR", rate: 45, txt: "Euro", exchangedate: "01.01.2026" }] };
    }
    if (String(url).includes("inzhur.reit")) return { ok: true, json: async () => [{ id: "fund", type: "fund", slug: "inzhur-reit", title: "REIT", assetDetails: { isin: "TEST", returnRates: { rate: 10 }, paymentSchedule: [] } }] };
    throw new Error("Unexpected external request: " + url);
  });
  async function get(url) { const response = await fetch(base + url); return { status: response.status, data: await response.json() }; }

  await t.test("passes query parameters to each history provider", async () => {
    for (const [url, provider, field, value] of [
      ["/api/market-data/time-series?symbol=AAPL&interval=1day", "Twelve Data", "symbol", "AAPL"],
      ["/api/market-data/index-history?symbol=.INX", "FRED", "symbol", ".INX"],
      ["/api/market-data/currency-history?code=USD", "NBU", "code", "USD"],
      ["/api/market-data/frankfurter-history?ticker=USEU", "Frankfurter", "ticker", "USEU"],
    ]) {
      const result = await get(url);
      assert.equal(result.status, 200);
      assert.equal(result.data.provider, provider);
      assert.equal(result.data.meta[field], value);
    }
    assert.deepEqual((await get("/api/macroeconomics")).data, { inflation: { annual: [] } });
    assert.deepEqual((await get("/api/macroeconomics/policy-rate")).data, { policyRate: [{ date: "2026-01-01", value: 15 }] });
  });
  await t.test("preserves upstream error status and code", async () => {
    providerFailure = true;
    assert.deepEqual(await get("/api/market-data/time-series?symbol=AAPL"), { status: 429, data: { error: "Quota reached", code: "TWELVE_DATA_RATE_LIMITED" } });
  });
  await t.test("serves cached NBU rates when an expired cache cannot be refreshed", async () => {
    assert.equal((await get("/api/exchange-rates")).data.cached, null);
    assert.equal((await get("/api/exchange-rates")).data.cached, true);
    now += 3600001;
    nbuFailure = true;
    const stale = await get("/api/exchange-rates");
    assert.equal(stale.status, 200);
    assert.equal(stale.data.stale, true);
    assert.deepEqual(stale.data.rates, { UAH: 1, USD: 40, EUR: 45 });
    assert.equal((await get("/api/market-data/currencies")).status, 502);
  });
  await t.test("returns the existing Inzhur catalog fields and cache flag", async () => {
    const first = await get("/api/inzhur-assets");
    assert.equal(first.status, 200);
    assert.equal(first.data.cached, null);
    assert.deepEqual(first.data.assets[0].returnRates, { rate: 10 });
    assert.equal((await get("/api/inzhur-assets")).data.cached, true);
  });
});
