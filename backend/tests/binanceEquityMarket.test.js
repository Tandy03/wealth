const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

let server;

test.before(async () => {
  server = http.createServer((req, res) => {
    assert.equal(req.headers["x-mbx-apikey"], "test-key");
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/sapi/v1/equity/market/exchangeInfo")) {
      return res.end(JSON.stringify({ timezone: "UTC", symbols: [{ symbol: "SPY", tradability: "BUY_SELL" }, { symbol: "SMH", tradability: "BUY_SELL" }] }));
    }
    if (req.url.startsWith("/sapi/v1/equity/market/tokenized-assets")) {
      return res.end(JSON.stringify([
        { assetCode: "SPYB", underlyingEquitySymbol: "SPY", multiplier: "1", multiplierValid: true },
        { assetCode: "SMHB", underlyingEquitySymbol: "SMH", multiplier: "1", multiplierValid: true },
      ]));
    }
    if (req.url.includes("symbol=SPY")) return res.end(JSON.stringify({ symbol: "SPY", bidPrice: "600", askPrice: "602" }));
    if (req.url.includes("symbol=SMH")) return res.end(JSON.stringify({ symbol: "SMH", bidPrice: "300", askPrice: "304" }));
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BINANCE_API_KEY = "test-key";
  process.env.BINANCE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test("maps SPYB to SPY and calculates its midpoint price", async () => {
  const { getTokenizedEquityPrice } = require("../services/binance/equityMarket");
  const result = await getTokenizedEquityPrice("SPYB");
  assert.equal(result.underlyingSymbol, "SPY");
  assert.equal(result.currentPrice, 601);
});

test("maps SMHB to SMH and calculates its midpoint price", async () => {
  const { getTokenizedEquityPrice } = require("../services/binance/equityMarket");
  const result = await getTokenizedEquityPrice("smhb");
  assert.equal(result.underlyingSymbol, "SMH");
  assert.equal(result.currentPrice, 302);
});
