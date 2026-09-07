const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let server;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.pathname, "/time_series");
    assert.equal(url.searchParams.get("apikey"), "test-twelve-key");
    assert.equal(url.searchParams.get("symbol"), "AAPL");
    assert.equal(url.searchParams.get("interval"), "1day");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      meta: { symbol: "AAPL", interval: "1day", currency: "USD", exchange: "NASDAQ" },
      values: [{ datetime: "2026-09-03", open: "230", high: "234", low: "229", close: "233.50", volume: "1000" }],
      status: "ok",
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.TWELVE_DATA_API_KEY = "test-twelve-key";
  process.env.TWELVE_DATA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test("normalizes an AAPL daily time series for future charts", async () => {
  const { getTimeSeries } = require("../services/twelveData/client");
  const result = await getTimeSeries({ symbol: "aapl", interval: "1day", outputsize: 365 });
  assert.equal(result.meta.symbol, "AAPL");
  assert.equal(result.values[0].close, 233.5);
  assert.equal(result.values[0].volume, 1000);
});
