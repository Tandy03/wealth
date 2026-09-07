const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let server;

test.before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.searchParams.get("valcode"), "USD");
    assert.equal(url.searchParams.get("start"), "20260901");
    assert.equal(url.searchParams.get("end"), "20260904");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([
      { exchangedate: "01.09.2026", cc: "USD", rate: 44.1, rate_per_unit: 44.1 },
      { exchangedate: "04.09.2026", cc: "USD", rate: 44.7, rate_per_unit: 44.7 },
    ]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.NBU_HISTORY_URL = `http://127.0.0.1:${server.address().port}/exchange_site`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test("normalizes NBU USD/UAH history for the Market chart", async () => {
  const { getNbuCurrencyHistory } = require("../services/nbu/exchangeHistory");
  const result = await getNbuCurrencyHistory({ code: "usd", startDate: "2026-09-01", endDate: "2026-09-04" });
  assert.equal(result.meta.symbol, "USD/UAH");
  assert.equal(result.values.length, 2);
  assert.equal(result.values[1].datetime, "2026-09-04");
  assert.equal(result.values[1].close, 44.7);
});
