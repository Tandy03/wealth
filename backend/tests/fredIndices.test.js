const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let server;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.pathname, "/fred/series/observations");
    assert.ok(["SP500", "DJIA", "NASDAQCOM"].includes(url.searchParams.get("series_id")));
    assert.equal(url.searchParams.get("api_key"), "test-fred-key");
    assert.equal(url.searchParams.get("file_type"), "json");
    assert.equal(url.searchParams.get("observation_start"), "2026-09-01");
    assert.equal(url.searchParams.get("observation_end"), "2026-09-04");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ observations: [
      { date: "2026-09-02", value: "." },
      { date: "2026-09-03", value: "6502.08" },
    ] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.FRED_API_KEY = "test-fred-key";
  process.env.FRED_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test("normalizes FRED S&P 500 observations for the market chart", async () => {
  const { getIndexHistory } = require("../services/fred/indices");
  const result = await getIndexHistory({ symbol: ".INX", startDate: "2026-09-01", endDate: "2026-09-04" });
  assert.equal(result.provider, "FRED");
  assert.equal(result.meta.symbol, ".INX");
  assert.equal(result.meta.providerSymbol, "SP500");
  assert.equal(result.meta.exchange, "S&P 500 Index");
  assert.equal(result.values.length, 1);
  assert.equal(result.values[0].datetime, "2026-09-03");
  assert.equal(result.values[0].close, 6502.08);
});

test("maps Dow Jones and NASDAQ tickers to their FRED series", async () => {
  const { getIndexHistory } = require("../services/fred/indices");
  const dow = await getIndexHistory({ symbol: ".DJI", startDate: "2026-09-01", endDate: "2026-09-04" });
  const nasdaq = await getIndexHistory({ symbol: ".IXIC", startDate: "2026-09-01", endDate: "2026-09-04" });
  assert.equal(dow.meta.providerSymbol, "DJIA");
  assert.equal(dow.meta.exchange, "Dow Jones Industrial Average");
  assert.equal(nasdaq.meta.providerSymbol, "NASDAQCOM");
  assert.equal(nasdaq.meta.exchange, "NASDAQ Composite Index");
});
