const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const model = require('../../frontend/js/state-model');
const frontend = path.join(__dirname, '../../frontend');
const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const fixture = () => ({ ...model.createEmptyState(), assets: [{ id: 'stock', name: 'Smoke Stock', type: 'stock', quantity: 2, purchasePrice: 100, currentPrice: 120, purchaseDate: '2026-01-01', currency: 'USD' }], transactions: [{ id: 'buy', assetId: 'stock', type: 'BUY', quantity: 2, amount: 200, date: '2026-01-01', currency: 'USD' }] });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
async function harness(t, { initial = fixture(), blockMarkets = false, locale = 'en' } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  window.localStorage.setItem('fino-language', locale);
  const observers = [];
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  t.after(async () => {
    observers.forEach(observer => observer.disconnect());
    await new Promise(resolve => setTimeout(resolve, 40));
    dom.window.close();
  });
  if (window.document.readyState === 'loading') await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  window.console = { log() {}, info() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.setInterval = () => 0;
  let stored = model.normalizeState(initial);
  let queue = Promise.resolve();
  const repository = {
    readData: async () => structuredClone(stored),
    saveData: async data => { stored = model.normalizeState(data); },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  };
  const portfolio = require('../domain/portfolioService').createService(repository);
  const wallet = require('../domain/walletService').createService(repository);
  const requests = [];
  window.fetch = async (url, options = {}) => {
    const target = new URL(url, 'http://localhost/');
    const route = target.pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ route, method, body });
    if (blockMarkets && /exchange-rates|currency-history|index-history/.test(route)) return new Promise(() => {});
    let data;
    if (route === '/api/data') data = stored;
    else if (route === '/api/sync/status') data = { connected: false, enabled: false };
    else if (route === '/api/exchange-rates') data = { rates: { USD: 40, EUR: 45 } };
    else if (route.endsWith('currency-history')) data = { values: [{ datetime: '2026-01-01', close: 40 }] };
    else if (route.endsWith('index-history')) data = { values: [] };
    else if (route === '/api/assets' && method === 'POST') data = await portfolio.createAsset(body);
    else if (/\/api\/assets\/.+\/buy$/.test(route)) data = await portfolio.buyMoreAsset(route.split('/')[3], body);
    else if (route === '/api/wallet' && method === 'PUT') data = await wallet.saveWallet(body);
    else throw new Error('Unexpected UI request: ' + route);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  for (const match of html.matchAll(/<script src="(\/js\/[^"?]+)(?:\?[^"\s]*)?"/g)) {
    if (match[1].endsWith('mobile-config.generated.js')) continue;
    vm.runInContext(fs.readFileSync(path.join(frontend, match[1]), 'utf8'), dom.getInternalVMContext(), { filename: match[1] });
    if (locale !== 'en' && match[1].endsWith('/i18n.js')) window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  await window.init();
  await flush();
  return { window, document: window.document, errors, requests, stored: () => structuredClone(stored), eval: expression => vm.runInContext(expression, dom.getInternalVMContext()) };
}
test('UI smoke: Ukrainian dynamic content retains names and stored category values', async t => {
  const initial = fixture();
  initial.assets[0].name = 'Stock';
  const h = await harness(t, { initial, locale: 'uk' });
  assert.deepEqual(h.errors, []);
  assert.match(h.document.querySelector('#portfolio-table').textContent, /Stock/);
  assert.match(h.document.querySelector('#wallet-current-body').textContent, /Десятина/);
  assert.doesNotMatch(h.document.querySelector('#wallet-current-body').textContent, /Expenses for|remaining|Salary/);
  assert.doesNotMatch(h.document.querySelector('#calendar-month-title').textContent, /January|October|November/);
  h.window.ui.forms.wallet.expense();
  await flush();
  const category = h.document.querySelector('#expense-category option[value="Tithe"]');
  assert.ok(category);
  assert.equal(category.textContent, 'Десятина');
  assert.equal(category.value, 'Tithe');
});

test('UI smoke: populated portfolio renders every main section and navigation works', async t => {
  const h = await harness(t);
  assert.deepEqual(h.errors, []);
  assert.match(h.document.querySelector('#dashboard-assets').textContent, /Smoke Stock/);
  assert.match(h.document.querySelector('#portfolio-table').textContent, /Smoke Stock/);
  assert.notEqual(h.document.querySelector('#profit-total').textContent.trim(), '');
  assert.ok(h.document.querySelector('#wallet-current-body tr'));
  assert.equal(h.document.querySelectorAll('#calendar-grid .calendar-day').length, 42);
  h.document.querySelector('#open-investments').click();
  h.document.querySelector('[data-section="portfolio"]').click();
  assert.equal(h.document.querySelector('#portfolio-section').classList.contains('active'), true);
  h.document.querySelector('[data-section="analytics"]').click();
  assert.equal(h.document.querySelector('#analytics-section').classList.contains('active'), true);
  assert.deepEqual(h.errors, []);
});
test('UI smoke: empty state and missing external APIs still show usable sections', async t => {
  const h = await harness(t, { initial: { assets: [] }, blockMarkets: true });
  assert.deepEqual(h.errors, []);
  assert.match(h.document.querySelector('#portfolio-table').textContent, /No assets yet/);
  assert.ok(h.document.querySelector('#wallet-current-body tr'));
  assert.equal(h.eval('stateStore.getData().schemaVersion'), 1);
  h.document.querySelector('#add-asset-btn').click();
  assert.equal(h.document.querySelector('#asset-modal').classList.contains('open'), true);
  assert.deepEqual(h.errors, []);
});
test('UI smoke: extracted buy form submits once and refreshes the portfolio', async t => {
  const h = await harness(t);
  h.window.ui.forms.buy.open('stock');
  const form = h.document.querySelector('#buy-more-form');
  form.elements.quantity.value = '1';
  form.elements.purchasePrice.value = '150';
  form.elements.purchaseDate.value = '2026-02-01';
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(h.requests.filter(request => request.route === '/api/assets/stock/buy').length, 1);
  assert.equal(h.stored().assets[0].quantity, 3);
  assert.equal(h.eval('stateStore.getData().assets[0].quantity'), 3);
  assert.equal(h.document.querySelector('#buy-more-modal').classList.contains('open'), false);
  assert.deepEqual(h.errors, []);
});

test('UI smoke: month, date and detail filters retain their event behavior', async t => {
  const h = await harness(t);
  for (const selector of ['#wallet-archive-month', '#wallet-expenses-month', '#wallet-chart-month', '#wallet-monthly-category', '#wallet-period-mode', '#profit-from', '#profit-to', '#portfolio-history-mode', '#asset-allocation-mode', '#asset-price-history-select', '#asset-hide-sales', '#asset-only-current']) {
    const input = h.document.querySelector(selector);
    if (input) input.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  }
  await flush();
  assert.deepEqual(h.errors, []);
  assert.match(h.document.querySelector('#wallet-archive-table').textContent, /Monthly total/);
});

test('UI smoke: renderers use explicit snapshots and never fetch or mutate financial data', async t => {
  const h = await harness(t);
  const current = h.eval('stateStore.getState()');
  const snapshot = { ...current, data: model.normalizeState({ ...fixture(), assets: [{ ...fixture().assets[0], name: 'Isolated view', quantity: 3 }] }) };
  const original = JSON.stringify(snapshot.data);
  const requestCount = h.requests.length;
  h.window.ui.dashboard.render(snapshot);
  h.window.ui.portfolio.render(snapshot);
  h.window.ui.wallet.render(snapshot);
  assert.match(h.document.querySelector('#dashboard-assets').textContent, /Isolated view/);
  assert.match(h.document.querySelector('#portfolio-table').textContent, /Isolated view/);
  assert.equal(JSON.stringify(snapshot.data), original);
  assert.equal(current.data.assets[0].name, 'Smoke Stock');
  assert.equal(h.requests.length, requestCount);
  assert.deepEqual(h.errors, []);
});

test('UI smoke: wallet plan and expense form persist through the action layer', async t => {
  const h = await harness(t);
  const plan = h.document.querySelector('[data-wallet-plan="Health"]');
  plan.value = '50';
  plan.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await flush();
  const key = h.document.querySelector('#wallet-current-month').value;
  assert.equal(h.stored().wallet.months[key].plans.Health, 50);
  h.document.querySelector('#add-expense-btn').click();
  const form = h.document.querySelector('#expense-form');
  form.elements.date.value = key + '-01';
  form.elements.category.value = 'Health';
  form.elements.amount.value = '20';
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(h.stored().wallet.expenses.length, 1);
  assert.equal(h.stored().wallet.expenses[0].amount, 20);
  assert.equal(h.document.querySelector('#expense-modal').classList.contains('open'), false);
  assert.deepEqual(h.errors, []);
});
