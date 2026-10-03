const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname, '../../frontend/js/renderers/dashboard.js'), 'utf8');
const dashboard = appSource.slice(appSource.indexOf('function renderDashboard('), appSource.indexOf('function renderUpcomingPayments('));
const financeSource = fs.readFileSync(path.join(__dirname, '../../frontend/js/analytics/portfolio-finance.js'), 'utf8');
const price = financeSource.slice(financeSource.indexOf('function getCurrentPrice('), financeSource.indexOf('function calculatePortfolioValue('));
function render(assets) {
  const container = { innerHTML: '', querySelectorAll: () => [] };
  const rates = { UAH: 1, USD: 40, EUR: 45 };
  const context = { state: { data: { assets, sales: [], payments: [] } }, document: { querySelector: (selector) => selector === '#dashboard-assets' ? container : null },
    stateStore: { getState: () => context.state }, createRenderServices: () => context, bindDashboardHoldings: () => {},
    calculateInvested: () => 0, calculatePortfolioValue: () => 0, getUnrealizedPriceGrowth: () => 0, getMaturityCostBasis: () => 0, toUAHPurchaseCost: () => 0, renderReinvestmentForecast: () => {}, renderUpcomingPayments: () => {}, setupPortfolioCurrencyHover: () => {},
    getAvailableQuantity: (id) => { const asset = assets.find(item => item.id === id); return asset.closedAt ? 0 : asset.quantity - (asset.sold || 0); },
    normalizeNumber: (value) => Number(value) || 0, convertCurrency: (amount, from = 'UAH', to = 'UAH') => amount * rates[from] / rates[to], toUAH: (amount, currency = 'UAH') => amount * rates[currency],
    portfolioMoneyWithUahHover: (amount, currency, uah) => amount + ' ' + currency + ' [' + uah + ' UAH]', formatQuantity: (value) => String(value), escapeHtml: (value) => String(value), typeLabels: {} };
  vm.createContext(context); vm.runInContext(price + dashboard, context); context.renderDashboard(); return container.innerHTML;
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
