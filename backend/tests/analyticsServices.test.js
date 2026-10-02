const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../frontend/js/state-model');
const values = require('../../frontend/js/analytics/values');
const marketModule = require('../../frontend/js/market-data');
const financeModule = require('../../frontend/js/analytics/portfolio-finance');
const cashflowModule = require('../../frontend/js/cashflow');
function services() {
  const state = { data: model.createEmptyState(), rebalanceDrafts: [], purchaseExchangeRates: {} };
  const market = marketModule.createService({ state, values, exchangeRates: { UAH: 1, USD: 40 }, historicalRates: { UAH: 1, USD: 40 } });
  const finance = financeModule.createService({ state, market, values });
  const cashflow = cashflowModule.createService({ state, market, finance, values });
  return { state, finance, cashflow };
}
test('rebalance uses current values and planned assets without touching state', () => {
  const { state, finance } = services();
  state.data.assets.push({ id: 'stock', name: 'ABC', type: 'stock', quantity: 2, purchasePrice: 80, currentPrice: 100, currency: 'USD' },
    { id: 'cash', type: 'savings', quantity: 100000, purchasePrice: 1, currency: 'UAH' });
  state.rebalanceDrafts.push({ id: 'planned-bond', label: 'Bond' });
  const before = structuredClone(state);
  const plan = finance.calculateRebalancePlan([{ groupId: 'stock::abc', percent: 50 }, { groupId: 'planned-bond', percent: 50 }]);
  assert.equal(plan.totalToInvest, 8000);
  assert.deepEqual(plan.recommendations.map(item => item.difference), [0, 8000]);
  assert.deepEqual(state, before);
  assert.throws(() => finance.calculateRebalancePlan([{ groupId: 'stock::abc', percent: 90 }]), /100/);
  assert.throws(() => finance.calculateRebalancePlan([{ percent: -10 }, { percent: 110 }]), /between/);
});
test('profit summaries preserve losses and calculate aggregate ROI', () => {
  const { cashflow } = services();
  const result = { assets: {
    'stock::a': { assetName: 'A', currency: 'UAH', invested: 100, dividends: 10, coupons: 0, maturity: 0, salesProfit: -30, priceGrowth: 0 },
    'stock::b': { assetName: 'B', currency: 'UAH', invested: 300, dividends: 0, coupons: 0, maturity: 0, salesProfit: 0, priceGrowth: 60 },
  } };
  const before = structuredClone(result);
  const summary = cashflow.summarizeProfit(result, { stock: 'Stocks' });
  assert.equal(summary.assetRows[0].roi, -20);
  assert.equal(summary.typeRows[0].totalProfit, 40);
  assert.equal(summary.typeRows[0].roi, 10);
  assert.equal(summary.typeRows[0].label, 'Stocks');
  assert.deepEqual(result, before);
});
