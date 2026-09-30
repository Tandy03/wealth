const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWeeklyPerformance } = require("../../frontend/js/portfolio-performance.js");

const asset = (id = "a", extra = {}) => ({ id, name: id, type: "etf", currency: "UAH", ...extra });
const buy = (assetId, date, quantity, price) => ({ id: `b-${assetId}-${date}-${quantity}`, assetId, type: "BUY", date, quantity, purchasePrice: price, amount: quantity * price, currency: "UAH" });
const latest = (result) => result.points.at(-1)?.value;

test("purchase alone creates neither profit nor loss", () => {
  const result = buildWeeklyPerformance({ assets: [asset()], transactions: [buy("a", "2026-09-01", 2, 100)] }, { today: "2026-09-06" });
  assert.equal(latest(result), 0);
});

test("multiple purchases preserve separate FIFO cost bases", () => {
  const data = { assets: [asset()], transactions: [buy("a", "2026-09-01", 1, 100), buy("a", "2026-09-02", 1, 120)], priceHistory: [{ assetId: "a", date: "2026-09-06", price: 130 }] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 40);
});

test("partial profitable sale preserves realized and unrealized profit", () => {
  const data = { assets: [asset()], transactions: [buy("a", "2026-09-01", 2, 100)], sales: [{ id: "s", assetId: "a", sellDate: "2026-09-03", quantity: 1, saleProceeds: 110 }], priceHistory: [{ assetId: "a", date: "2026-09-06", price: 105 }] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 15);
});

test("complete loss-making sale remains a legitimate negative result", () => {
  const data = { assets: [asset()], transactions: [buy("a", "2026-09-01", 1, 100)], sales: [{ assetId: "a", sellDate: "2026-09-03", quantity: 1, saleProceeds: 90 }] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), -10);
});

test("the two OVDP 9016 sales retain exactly 40.16 UAH realized profit", () => {
  const data = { assets: [asset("bond", { type: "ovdp" })], transactions: [buy("bond", "2026-08-01", 10, 1015.314)], sales: [
    { assetId: "bond", sellDate: "2026-09-02", quantity: 2, saleProceeds: 2038.02 },
    { assetId: "bond", sellDate: "2026-09-03", quantity: 8, saleProceeds: 8155.28 },
  ] };
  assert.ok(Math.abs(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })) - 40.16) < 1e-9);
});

test("sale followed by reinvestment does not manufacture profit", () => {
  const data = { assets: [asset("a"), asset("b")], transactions: [buy("a", "2026-09-01", 1, 100), buy("b", "2026-09-04", 1, 110)], sales: [{ assetId: "a", sellDate: "2026-09-03", quantity: 1, saleProceeds: 110 }] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 10);
});

test("bond maturity recognizes redemption and coupon without an artificial drop", () => {
  const data = { assets: [asset("bond", { type: "ovdp" })], transactions: [buy("bond", "2026-07-31", 1, 1073.74)], payments: [
    { id: "m", assetId: "bond", type: "MATURITY", amount: 1000, status: "received", receivedDate: "2026-08-19" },
    { id: "c", assetId: "bond", type: "COUPON", amount: 81.65, status: "received", receivedDate: "2026-08-19" },
  ] };
  assert.ok(Math.abs(latest(buildWeeklyPerformance(data, { today: "2026-08-23" })) - 7.91) < 1e-9);
});

test("mirrored payment is counted once and planned payment is ignored", () => {
  const data = { assets: [asset()], transactions: [buy("a", "2026-09-01", 1, 100), { assetId: "a", type: "DIVIDEND", date: "2026-09-03", amount: 5, paymentId: "p" }], payments: [
    { id: "p", assetId: "a", type: "DIVIDEND", amount: 5, status: "received", receivedDate: "2026-09-03" },
    { id: "future", assetId: "a", type: "DIVIDEND", amount: 50, status: "planned", date: "2026-09-04" },
  ] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 5);
});

test("latest same-day price is used and future prices do not leak backward", () => {
  const data = { assets: [asset()], transactions: [buy("a", "2026-09-01", 1, 100)], priceHistory: [
    { assetId: "a", recordedAt: "2026-09-06T09:00:00Z", price: 105 }, { assetId: "a", recordedAt: "2026-09-06T18:00:00Z", price: 107 }, { assetId: "a", recordedAt: "2026-09-07T09:00:00Z", price: 200 },
  ] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 7);
});

test("historical FX is applied on purchase and valuation dates", () => {
  const data = { assets: [asset("usd", { currency: "USD" })], transactions: [{ ...buy("usd", "2026-09-01", 1, 10), currency: "USD" }], priceHistory: [{ assetId: "usd", date: "2026-09-06", price: 11 }] };
  const rates = { "2026-09-01": 40, "2026-09-06": 42 };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06", exchangeRateOnDate: (_, date) => rates[date] })), 62);
});

test("taxable asset profit remains gross before taxes", () => {
  const data = { assets: [asset("reit", { type: "inzhur_reit" })], transactions: [buy("reit", "2026-09-01", 1, 100)], priceHistory: [{ assetId: "reit", date: "2026-09-06", price: 200 }] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 100);
});

test("missing FX produces a gap instead of an artificial loss", () => {
  const data = { assets: [asset("usd", { currency: "USD" })], transactions: [{ ...buy("usd", "2026-09-01", 1, 10), currency: "USD" }] };
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06", exchangeRateOnDate: () => null })), null);
});

test("week points use Sunday boundaries and preserve negative values", () => {
  const data = { assets: [asset()], transactions: [buy("a", "2026-09-01", 1, 100)], priceHistory: [{ assetId: "a", date: "2026-09-06", price: 90 }] };
  const result = buildWeeklyPerformance(data, { today: "2026-09-08" });
  assert.deepEqual(result.points.map((point) => point.date), ["2026-09-06", "2026-09-08"]);
  assert.equal(result.points[0].value, -10);
});

test("Savings data is excluded without being mutated", () => {
  const data = { assets: [asset("saved", { type: "savings", quantity: 500 }), asset()], transactions: [buy("saved", "2026-09-01", 500, 1), buy("a", "2026-09-01", 1, 100)] };
  const before = JSON.stringify(data);
  assert.equal(latest(buildWeeklyPerformance(data, { today: "2026-09-06" })), 0);
  assert.equal(JSON.stringify(data), before);
});

test("Crypto Earn compounds quantity daily at the configured APR", () => {
  const data = {
    assets: [asset("usdt", { type: "crypto_earn", annualRate: 36.5, currency: "UAH" })],
    transactions: [buy("usdt", "2026-09-01", 10, 100)],
  };
  const expected = 10 * 100 * ((1 + 0.365 / 365) ** 10 - 1);
  assert.ok(Math.abs(latest(buildWeeklyPerformance(data, { today: "2026-09-11" })) - expected) < 1e-8);
});
