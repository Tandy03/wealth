const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenderersDashboard } = require('../../frontend/js/renderers/dashboard');
function render(assets) {
  const container = { innerHTML: '', querySelectorAll: () => [] };
  const rates = { UAH: 1, USD: 40, EUR: 45 };
  const context = { state: { data: { assets, transactions: [], sales: [], payments: [] }, purchaseExchangeRates: {} }, document: { querySelector: (selector) => selector === '#dashboard-assets' ? container : null, getElementById: () => null },
    window: { FinoI18n: { t: text => text, format: text => text } },
    setReturnBenchmarkHover: () => {}, setXirrValue: () => {},
    createRenderServices: () => context, bindDashboardHoldings: () => {},
    calculateInvested: () => 0, calculatePortfolioValue: () => 0, getUnrealizedPriceGrowth: () => 0, getMaturityCostBasis: () => 0, toUAHPurchaseCost: () => 0, renderReinvestmentForecast: () => {}, renderUpcomingPayments: () => {}, setupPortfolioCurrencyHover: () => {},
    getAvailableQuantity: (id) => { const asset = assets.find(item => item.id === id); return asset.closedAt ? 0 : asset.quantity - (asset.sold || 0); },
    normalizeNumber: (value) => Number(value) || 0, convertCurrency: (amount, from = 'UAH', to = 'UAH') => amount * rates[from] / rates[to], toUAH: (amount, currency = 'UAH') => amount * rates[currency],
    portfolioMoneyWithUahHover: (amount, currency, uah) => amount + ' ' + currency + ' [' + uah + ' UAH]', formatQuantity: (value) => String(value), escapeHtml: (value) => String(value), typeLabels: {} };
  const values = require('../../frontend/js/analytics/values');
  context.stateStore = require('../../frontend/js/state-store').createStore({ model: require('../../shared/state-model'), initialState: context.state });
  context.state = context.stateStore.getState();
  const market = require('../../frontend/js/market-data').createService({ state: context.state, values, exchangeRates: rates, historicalRates: rates });
  const finance = require('../../frontend/js/analytics/portfolio-finance').createService({ state: context.state, values, market });
  const cashflow = require('../../frontend/js/cashflow').createService({ state: context.state, values, market, finance });
  // Exercise the actual metric collaborators; this test still isolates the
  // Portfolio card's mocked remaining-unit display from its sibling cards.
  context.createRenderServices = () => ({ ...context, ...market, ...finance, ...cashflow, getAvailableQuantity: context.getAvailableQuantity });
  createRenderersDashboard({ ...context, FinoI18n: context.window.FinoI18n, FinoDashboardAnalytics: require('../../frontend/js/analytics/dashboard') }).renderDashboard();
  return container.innerHTML;
}
test('Portfolio card displays current value for remaining units instead of invested cost', () => {
  const html = render([{ id: 'a', name: 'Stock', type: 'stock', quantity: 5, sold: 2, purchasePrice: 100, currentPrice: 120, currency: 'USD' }]);
  assert.match(html, /360 USD \[14400 UAH\]/);
  assert.doesNotMatch(html, /300 USD/);
});
test('Portfolio card sums the current value of grouped holdings across currencies', () => {
  const html = render([{ id: 'a', name: 'Stock', type: 'stock', quantity: 1, purchasePrice: 50, currentPrice: 100, currency: 'USD' }, { id: 'b', name: 'Stock', type: 'stock', quantity: 2, purchasePrice: 400, currentPrice: 500, currency: 'UAH' }]);
  assert.match(html, /125 USD \[5000 UAH\]/);
});
test('Portfolio current-value display retains fallback pricing and hides closed holdings', () => {
  const html = render([{ id: 'a', name: 'Fallback', type: 'stock', quantity: 2, purchasePrice: 100, currency: 'UAH' }, { id: 'b', name: 'Closed', type: 'ovdp', quantity: 2, purchasePrice: 1000, currentPrice: 1100, closedAt: '2026-01-01', currency: 'UAH' }]);
  assert.match(html, /200 UAH/); assert.doesNotMatch(html, /Closed/);
});
