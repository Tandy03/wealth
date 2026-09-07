const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let server;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.pathname, "/v2/rates");
    const base = url.searchParams.get("base");
    const quote = url.searchParams.get("quotes");
    assert.ok((base === "USD" && quote === "EUR") || (base === "EUR" && quote === "USD"));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([
      { date: "2026-09-03", base, quote, rate: base === "USD" ? 0.86 : 1.16 },
      { date: "2026-09-04", base, quote, rate: base === "USD" ? 0.87 : 1.15 },
    ]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.FRANKFURTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test("normalizes Frankfurter USD/EUR history for USEU", async () => {
  const { getExchangeHistory } = require("../services/frankfurter/exchangeHistory");
  const result = await getExchangeHistory({ ticker: "USEU", startDate: "2026-09-03", endDate: "2026-09-04" });
  assert.equal(result.meta.marketTicker, "USEU");
  assert.equal(result.meta.symbol, "USD/EUR");
  assert.equal(result.values[1].close, 0.87);
});

test("normalizes Frankfurter EUR/USD history for EUUS", async () => {
  const { getExchangeHistory } = require("../services/frankfurter/exchangeHistory");
  const result = await getExchangeHistory({ ticker: "EUUS", startDate: "2026-09-03", endDate: "2026-09-04" });
  assert.equal(result.meta.marketTicker, "EUUS");
  assert.equal(result.meta.symbol, "EUR/USD");
  assert.equal(result.meta.currency, "USD");
  assert.equal(result.values[1].close, 1.15);
});
