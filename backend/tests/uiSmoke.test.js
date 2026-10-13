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
async function harness(t, { initial = fixture(), blockMarkets = false, locale = 'en', charts = false, failWallet = false, native = false, nativeStorage: restoredStorage, macroFailureOnce = false } = {}) {
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
  const chartCalls = [];
  if (charts === 'real') {
    // jsdom has no canvas backend. Exercise the real Chart.js lifecycle with
    // a drawing context; browser layout and painted pixels need separate checks.
    window.HTMLCanvasElement.prototype.getContext = function () {
      const canvas = this;
      return new Proxy({ canvas, measureText: text => ({ width: String(text).length * 7 }), getLineDash: () => [] }, {
        get: (context, key) => key in context ? context[key] : () => {},
      });
    };
    vm.runInContext(fs.readFileSync(path.join(frontend, 'vendor/chart.umd.js'), 'utf8'), dom.getInternalVMContext());
    const Chart = window.Chart;
    window.Chart = new Proxy(Chart, {
      construct(Target, [canvas, config]) {
        config.options = { ...config.options, responsive: false, animation: false };
        return new Target(canvas, config);
      },
    });
  } else if (charts) window.Chart = class {
    constructor(canvas, config) { chartCalls.push({ canvas, config }); }
    destroy() {}
    update() {}
    resize() {}
  };
  let stored = model.normalizeState(initial);
  const nativeStorage = restoredStorage || new Map([
    ['fino-active-account', 'smoke@example.com'],
    ['fino-data-v1:smoke%40example.com', JSON.stringify(stored)],
  ]);
  if (native) {
    Object.defineProperty(window, 'crypto', { value: require('node:crypto').webcrypto });
    window.TextEncoder = TextEncoder;
    window.Capacitor = { isNativePlatform: () => true, Plugins: {
      FinoStorage: {
        get: async ({ key }) => ({ value: nativeStorage.get(key) || null }),
        set: async ({ key, value }) => nativeStorage.set(key, value),
        remove: async ({ key }) => nativeStorage.delete(key),
      },
      GoogleDriveAuth: { getAccessToken: async () => { throw Object.assign(new Error('Google authorization was cancelled.'), { code: 'AUTHORIZATION_REQUIRED' }); } },
    } };
    window.FINO_MOBILE_CONFIG = { proxyUrl: 'https://script.google.com/macros/s/mock/exec', proxyToken: 'mock-token' };
  }
  let queue = Promise.resolve();
  const repository = {
    readData: async () => structuredClone(stored),
    saveData: async data => { stored = model.normalizeState(data); },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  };
  const portfolio = require('../domain/portfolioService').createService(repository);
  const wallet = require('../domain/walletService').createService(repository);
  const requests = [];
  let macroCalls = 0, policyCalls = 0;
  let sessionValid = true;
  window.fetch = async (url, options = {}) => {
    const target = new URL(url, 'http://localhost/');
    const route = target.pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ route, method, body });
    if (native) throw new Error('Mock phone is offline.');
    if (route === '/api/session' && method === 'POST') {
      assert.equal(options.headers['X-Fino-Session'], 'renew');
      sessionValid = true;
      return new Response(null, { status: 204 });
    }
    if (route.startsWith('/api/') && !sessionValid) return new Response(JSON.stringify({ error: 'Session expired.', code: 'BROWSER_SESSION_REQUIRED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    if (blockMarkets && /exchange-rates|currency-history|index-history/.test(route)) return new Promise(() => {});
    let data;
    if (route === '/api/data') data = stored;
    else if (route === '/api/sync/status') data = { connected: false, enabled: false };
    else if (route === '/api/exchange-rates') data = { rates: { USD: 40, EUR: 45 } };
    else if (route.endsWith('currency-history')) data = { values: [{ datetime: '2026-01-01', close: 40 }] };
    else if (route.endsWith('index-history')) data = { values: [] };
    else if (route === '/api/macroeconomics') {
      const failed = macroFailureOnce && ++macroCalls === 1;
      data = { exchangeRates: [], inflation: { annual: [], monthly: [] }, gdp: failed ? { nominal: [], realIndex: [] } : { nominal: [{ date: '2024', value: 7658659 }], realIndex: [{ date: '2024', value: 103.2 }] }, errors: failed ? { gdp: 'Temporary upstream failure' } : {} };
    }
    else if (route === '/api/macroeconomics/policy-rate') {
      if (macroFailureOnce && ++policyCalls === 1) return new Response(JSON.stringify({ error: 'Temporary policy failure' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      data = { policyRate: [{ date: '2026-01-01', value: 15 }, { date: '2026-02-01', value: 15.5 }] };
    }
    else if (route === '/api/assets' && method === 'POST') data = await portfolio.createAsset(body);
    else if (/\/api\/assets\/.+\/buy$/.test(route)) data = await portfolio.buyMoreAsset(route.split('/')[3], body);
    else if (route === '/api/wallet' && method === 'PUT') {
      if (failWallet) return new Response(JSON.stringify({ error: 'Storage unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      data = await wallet.saveWallet(body);
    }
    else throw new Error('Unexpected UI request: ' + route);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  for (const match of html.matchAll(/<script src="(\/js\/[^"?]+)(?:\?[^"\s]*)?"/g)) {
    if (match[1].endsWith('mobile-config.generated.js')) continue;
    vm.runInContext(fs.readFileSync(path.join(frontend, match[1]), 'utf8'), dom.getInternalVMContext(), { filename: match[1] });
    if (locale !== 'en' && match[1].endsWith('/i18n.js')) window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  await window.init();
  if (native) await window.mobileApi.waitForSync();
  await flush();
  return { window, document: window.document, errors, requests, chartCalls, nativeStorage, expireSession: () => { sessionValid = false; }, stored: () => structuredClone(stored), eval: expression => vm.runInContext(expression, dom.getInternalVMContext()) };
}

test('web wallet renews an expired browser session and saves the input without showing an error', async t => {
  const h = await harness(t);
  h.document.querySelector('#open-wallet').click();
  h.expireSession();
  const plan = h.document.querySelector('[data-wallet-plan="Health"]');
  plan.value = '250'; plan.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(h.stored().wallet.months['2026-10'].plans.Health, 250);
  assert.equal(h.document.querySelector('[data-wallet-plan="Health"]').disabled, false);
  assert.equal(h.document.querySelector('#notice-modal').classList.contains('open'), false);
  assert.equal(h.requests.filter(request => request.route === '/api/session').length, 1);
  assert.equal(h.requests.filter(request => request.route === '/api/wallet' && request.method === 'PUT').length, 2);
  assert.deepEqual(h.errors, []);
});

test('macro charts recover GDP and policy-rate data on reopening after a temporary failure', async t => {
  const h = await harness(t, { charts: true, macroFailureOnce: true });
  h.document.querySelector('[data-section="macroeconomics"]').click(); await flush();
  assert.equal(h.eval('stateStore.getState().macroLoaded'), false);
  assert.equal(h.document.querySelector('#macro-errors').hidden, false);
  h.document.querySelector('[data-section="dashboard"]').click();
  h.document.querySelector('[data-section="macroeconomics"]').click(); await flush();
  assert.equal(h.document.querySelector('#macro-errors').hidden, true);
  assert.equal(h.eval('stateStore.getState().macroLoaded'), true);
  const gdp = h.chartCalls.filter(call => call.canvas.id === 'macro-gdp-chart').at(-1).config;
  assert.equal(gdp.data.datasets[0].data[0], 7658659);
  assert.ok(Math.abs(gdp.data.datasets[1].data[0] - 3.2) < 1e-9);
  const policy = h.chartCalls.filter(call => call.canvas.id === 'macro-policy-rate').at(-1).config;
  assert.deepEqual(Array.from(policy.data.datasets[0].data), [15, 15.5]);
  assert.deepEqual(h.errors, []);
});

test('native UI boots with cancelled authorization, renders analytics offline, saves and recovers its journal', async t => {
  const initial = fixture();
  initial.wallet.expenses = [{ id: 'food', date: '2026-10-02', category: 'Health', amount: 50 }];
  const h = await harness(t, { initial, native: true, charts: 'real' });
  assert.ok(h.document.querySelector('#portfolio-table').textContent.includes('Smoke Stock'));
  assert.equal((await h.window.mobileApi.getGoogleDriveStatus()).state, 'auth-required');
  h.document.querySelector('#open-wallet').click();
  h.document.querySelector('#wallet-chart-month').value = '2026-10';
  h.document.querySelector('[data-wallet-tab="charts"]').click(); await flush();
  for (const id of ['wallet-category-chart', 'wallet-daily-chart', 'wallet-monthly-chart', 'wallet-period-chart']) {
    assert.ok(h.window.Chart.getChart(h.document.getElementById(id)), id + ' initializes with the native adapter');
  }
  h.document.querySelector('[data-wallet-tab="current"]').click();
  const plan = h.document.querySelector('[data-wallet-plan="Health"]');
  plan.value = '250'; plan.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await flush(); await h.window.mobileApi.waitForSync(); await flush();
  const current = await h.window.mobileApi.getData({ sync: false });
  assert.equal(current.wallet.months['2026-10'].plans.Health, 250);
  assert.equal((await h.window.mobileApi.getGoogleDriveStatus()).savedRemotely, false);
  assert.ok(h.nativeStorage.get('fino-journal-v1:smoke%40example.com'));
  assert.ok(h.requests.every(request => !request.route.startsWith('/api/')), 'native UI never needs a desktop server');
  assert.deepEqual(h.errors, []);
  h.nativeStorage.set('fino-data-v1:smoke%40example.com', '{broken mirror');
  const restarted = await harness(t, { native: true, nativeStorage: h.nativeStorage });
  const recovered = await restarted.window.mobileApi.getData({ sync: false });
  assert.equal(recovered.wallet.months['2026-10'].plans.Health, 250);
  assert.equal(recovered.assets[0].name, 'Smoke Stock');
  assert.deepEqual(restarted.errors, []);
});

test('UI smoke: wallet analytics renders all four charts with expenses and applies filters', async t => {
  const initial = fixture();
  initial.wallet.expenses = [
    { id: 'salary', date: '2026-10-01', category: 'Salary', amount: 1000 },
    { id: 'food', date: '2026-10-02', category: 'Groceries + household', amount: 100 },
    { id: 'health', date: '2026-10-03', category: 'Health', amount: 50 },
    { id: 'tithe', date: '2026-10-04', category: 'Tithe', amount: 20 },
    { id: 'previous', date: '2026-09-01', category: 'Health', amount: 30 },
  ];
  const h = await harness(t, { initial, charts: true });
  h.document.querySelector('#wallet-chart-month').value = '2026-10';
  h.document.querySelector('[data-wallet-tab="charts"]').click();
  await flush();
  assert.deepEqual(h.errors, []);
  for (const id of ['wallet-category-chart', 'wallet-daily-chart', 'wallet-monthly-chart', 'wallet-period-chart']) {
    assert.ok(h.chartCalls.some(call => call.canvas.id === id), id + ' must render');
  }
  const latest = id => h.chartCalls.filter(call => call.canvas.id === id).at(-1).config;
  assert.equal(latest('wallet-category-chart').data.datasets[0].data.reduce((a, b) => a + b, 0), 170);
  assert.equal(latest('wallet-daily-chart').data.datasets[0].data.reduce((a, b) => a + b, 0), 170);
  assert.deepEqual(Array.from(latest('wallet-monthly-chart').data.datasets[0].data), [30, 170]);
  assert.equal(latest('wallet-period-chart').data.datasets[0].data.at(-1), 200);
  const category = h.document.querySelector('#wallet-monthly-category');
  category.value = 'Health';
  category.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.deepEqual(Array.from(latest('wallet-monthly-chart').data.datasets[0].data), [30, 50]);
  const mode = h.document.querySelector('#wallet-period-mode');
  mode.value = '__expenses__';
  mode.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.equal(latest('wallet-period-chart').data.datasets[0].data.at(-1), 180);
  assert.deepEqual(h.errors, []);
});

test('UI smoke: bundled Chart.js builds wallet charts and interactive legends without a CDN', async t => {
  const initial = fixture();
  initial.wallet.expenses = [{ id: 'food', date: '2026-10-02', category: 'Health', amount: 125 }];
  const h = await harness(t, { initial, charts: 'real' });
  assert.equal(h.window.Chart.version, '4.5.1');
  assert.match(html, /<script src="\/vendor\/chart\.umd\.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+https?:/);
  h.document.querySelector('#wallet-chart-month').value = '2026-10';
  h.document.querySelector('[data-wallet-tab="charts"]').click();
  await flush();
  assert.deepEqual(h.errors, []);
  const chart = h.window.Chart.getChart('wallet-category-chart');
  assert.ok(chart);
  assert.equal(chart.data.datasets[0].data[0], 125);
  const legend = h.document.querySelector('#wallet-category-legend button');
  assert.ok(legend);
  assert.equal(chart.getDataVisibility(0), true);
  legend.click();
  assert.equal(chart.getDataVisibility(0), false);
  assert.equal(h.document.querySelector('#wallet-category-legend button').getAttribute('aria-pressed'), 'false');
  for (const id of ['wallet-daily-chart', 'wallet-monthly-chart', 'wallet-period-chart']) assert.ok(h.window.Chart.getChart(id), id);
  assert.deepEqual(h.errors, []);
});

test('UI smoke: asset price history excludes USDT by name or symbol without changing holdings', async t => {
  const initial = fixture();
  initial.assets.push(
    { id: 'usdt', name: ' USdt ', type: 'crypto_earn', quantity: 100, purchasePrice: 1, currentPrice: 1, purchaseDate: '2026-01-01', currency: 'USD' },
    { id: 'usdt-symbol', name: 'Earn balance', symbol: 'usdt', type: 'crypto_earn', quantity: 100, purchasePrice: 1, currentPrice: 1, purchaseDate: '2026-01-01', currency: 'USD' },
    { id: 'btc', name: 'BTC', type: 'crypto_earn', quantity: 0.1, purchasePrice: 50000, currentPrice: 55000, purchaseDate: '2026-01-01', currency: 'USD' },
  );
  initial.priceHistory = [
    { assetId: 'stock', price: 120, date: '2026-10-01', currency: 'USD' },
    { assetId: 'usdt', price: 1, date: '2026-10-01', currency: 'USD' },
  ];
  const h = await harness(t, { initial, charts: 'real' });
  const before = JSON.stringify(h.eval('stateStore.getData()'));
  h.window.renderAssetPriceHistoryChart();
  const names = Array.from(h.document.querySelector('#asset-price-history-select').options, option => option.textContent);
  assert.deepEqual(names, ['Smoke Stock', 'BTC']);
  assert.equal(h.window.Chart.getChart('asset-price-history-chart').data.datasets[0].data[0].y, 120);
  assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
  assert.equal(h.stored().assets.length, 4);
  assert.deepEqual(h.errors, []);
});
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

test('UI smoke: a failed wallet plan save restores its input and preserves browser and server state', async t => {
  const h = await harness(t, { failWallet: true });
  const browserBefore = JSON.stringify(h.eval('stateStore.getData()'));
  const serverBefore = h.stored();
  const plan = h.document.querySelector('[data-wallet-plan="Health"]');
  const previous = plan.value;
  plan.value = '50';
  plan.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(h.document.querySelector('[data-wallet-plan="Health"]').value, previous);
  assert.equal(h.document.querySelector('[data-wallet-plan="Health"]').disabled, false);
  assert.equal(JSON.stringify(h.eval('stateStore.getData()')), browserBefore);
  assert.deepEqual(h.stored(), serverBefore);
  assert.ok(h.errors.some(error => error.includes('Storage unavailable')));
  assert.ok(h.errors.every(error => !error.includes('Uncaught')));
});

test('UI smoke: failed expense submission retains the draft for retry without committing it', async t => {
  const h = await harness(t, { failWallet: true });
  const before = JSON.stringify(h.eval('stateStore.getData()'));
  h.document.querySelector('#add-expense-btn').click();
  const form = h.document.querySelector('#expense-form');
  form.elements.date.value = '2026-10-01';
  form.elements.category.value = 'Health';
  form.elements.amount.value = '20';
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(h.document.querySelector('#expense-modal').classList.contains('open'), true);
  assert.equal(form.elements.amount.value, '20');
  assert.equal(h.stored().wallet.expenses.length, 0);
  assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
  assert.ok(h.errors.every(error => !error.includes('Uncaught')));
});

test('UI smoke: unknown legacy payment types are displayed as text in history and calendar details', async t => {
  const initial = fixture();
  const type = '<img src=x onerror=alert(1)>';
  initial.payments.push({ id: 'legacy', assetId: 'stock', assetName: 'Legacy payment', type: 'DIVIDEND', status: 'received', date: '2026-01-02', amount: 1, currency: 'USD' });
  const h = await harness(t, { initial });
  // The state contract rejects unknown remote types; renderers still escape old cached or manually injected values.
  h.eval('stateStore.getData().payments[0].type = ' + JSON.stringify(type) + '; renderTransactions();');
  assert.equal(h.document.querySelector('#transactions-table img'), null);
  assert.ok(h.document.querySelector('#transactions-table').textContent.includes(type));
  h.window.ui.calendar.showEvent({ id: 'legacy', source: 'payment', title: 'Legacy payment', type, status: 'received', date: '2026-01-02', amount: 1, currency: 'USD' });
  assert.equal(h.document.querySelector('#event-modal img'), null);
  assert.ok(h.document.querySelector('#event-modal').textContent.includes(type));
  assert.deepEqual(h.errors, []);
});
