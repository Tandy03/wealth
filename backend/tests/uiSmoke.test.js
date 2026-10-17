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
async function harness(t, { initial = fixture(), blockMarkets = false, locale = 'en', charts = false, failWallet = false, failRebalance = false, sessionDraft, native = false, nativeStorage: restoredStorage, macroFailureOnce = false, styles = false } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  if (styles) {
    const style = window.document.createElement('style');
    style.textContent = ['style.css', 'rebalance.css'].map(file => fs.readFileSync(path.join(frontend, 'css', file), 'utf8')).join('\n');
    window.document.head.append(style);
  }
  window.localStorage.setItem('fino-language', locale);
  if (sessionDraft) window.sessionStorage.setItem('fino-rebalance-draft-v1', sessionDraft);
  const observers = [];
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  t.after(async () => {
    await window.FinoRebalanceDashboard?.flush();
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
    constructor(canvas, config) { this.data = config.data; this.options = config.options; this.config = config; chartCalls.push({ canvas, config }); }
    destroy() {}
    update() { this.config.data = this.data; this.config.options = this.options; }
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
  const rebalance = require('../domain/rebalanceService').createService(repository);
  const requests = [];
  let rebalanceFailure = failRebalance;
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
    else if (route === '/api/rebalance' && method === 'PUT') {
      if (rebalanceFailure) return new Response(JSON.stringify({ error: 'Storage unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      try { data = await rebalance.saveRebalance(body); }
      catch (error) { return new Response(JSON.stringify(error.payload || { error: error.message }), { status: error.status || 500, headers: { 'Content-Type': 'application/json' } }); }
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
  return { window, document: window.document, errors, requests, chartCalls, nativeStorage, expireSession: () => { sessionValid = false; },
    failRebalance: value => { rebalanceFailure = value; }, replaceStored: next => { stored = model.normalizeState(next); },
    stored: () => structuredClone(stored), eval: expression => vm.runInContext(expression, dom.getInternalVMContext()) };
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
test('asset price history filters whole days and resets without changing portfolio data', async t => {
  for (const native of [false, true]) await t.test(native ? 'native adapter' : 'web adapter', async t => {
    const initial = fixture();
    initial.priceHistory = [
      { assetId: 'stock', price: 90, date: '2026-09-30', currency: 'USD' },
      { assetId: 'stock', price: 110, date: '2026-10-01', currency: 'USD' },
      { assetId: 'stock', price: 120, date: '2026-10-02', recordedAt: '2026-10-02T23:59:59.999', currency: 'USD' },
      { assetId: 'stock', price: 130, date: '2026-10-03', recordedAt: '2026-10-03T00:00:00', currency: 'USD' },
    ];
    const h = await harness(t, { initial, native, charts: 'real', locale: 'uk' });
    const before = JSON.stringify(h.eval('stateStore.getData()'));
    const from = h.document.querySelector('#asset-price-history-from');
    const to = h.document.querySelector('#asset-price-history-to');
    const values = () => Array.from(h.window.Chart.getChart('asset-price-history-chart').data.datasets[0].data, point => point.y);
    const setRange = (start, end) => {
      from.value = start; to.value = end;
      to.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    };
    setRange('2026-10-01', '2026-10-02');
    assert.deepEqual(values(), [110, 120], 'include the entire end day, exclude midnight of the next day');
    h.window.renderAssetPriceHistoryChart();
    assert.equal(from.value, '2026-10-01', 'rerenders retain the selected period');
    assert.deepEqual(values(), [110, 120]);
    setRange('2026-10-02', '');
    assert.deepEqual(values(), [120, 130], 'start-only range');
    setRange('', '2026-10-01');
    assert.deepEqual(values(), [90, 110], 'end-only range');
    setRange('2026-11-01', '2026-11-02');
    assert.deepEqual(values(), []);
    assert.match(h.document.querySelector('#asset-price-history-description').textContent, /немає записів ціни за вибраний період/);
    setRange('2026-10-03', '2026-10-01');
    assert.equal(to.validity.customError, true);
    assert.deepEqual(values(), []);
    assert.match(h.document.querySelector('#asset-price-history-description').textContent, /Кінцева дата не може бути раніше початкової/);
    setRange('2026-10-03', '2026-10-03');
    assert.equal(to.validity.valid, true);
    assert.deepEqual(values(), [130]);
    h.document.querySelector('#asset-price-history-all-time').click();
    assert.equal(from.value, ''); assert.equal(to.value, '');
    assert.equal(from.max, ''); assert.equal(to.min, '');
    assert.deepEqual(values(), [90, 110, 120, 130]);
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
    assert.equal(h.requests.some(request => request.route.startsWith('/api/') && ['POST', 'PUT', 'DELETE'].includes(request.method)), false);
    assert.deepEqual(h.errors, []);
  });
});

async function currencyRebalance(t, options = {}) {
  const initial = model.createEmptyState();
  initial.assets = [100, 200].map((price, index) => ({ id: 'fx-' + index, name: 'FX ' + index,
    type: 'stock', quantity: 10, purchasePrice: price, currentPrice: price, purchaseDate: '2026-01-01', currency: 'UAH' }));
  initial.transactions = initial.assets.map(asset => ({ id: 'buy-' + asset.id, assetId: asset.id,
    type: 'BUY', quantity: 10, amount: asset.purchasePrice * 10, date: '2026-01-01', currency: 'UAH' }));
  const h = await harness(t, { initial, ...options });
  h.document.querySelector('[data-section="rebalance"]').click();
  for (const input of h.document.querySelectorAll('[data-rebalance-group]')) {
    input.value = '50'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  }
  h.document.querySelector('#calculate-rebalance').click();
  await h.window.FinoRebalanceDashboard.flush(); await flush();
  h.summary = h.document.querySelector('#rebalance-invest-value').closest('.panel');
  h.footer = h.document.querySelector('.rebalance-result-total');
  h.enter = host => host.dispatchEvent(new h.window.MouseEvent('mouseenter'));
  h.leave = host => host.dispatchEvent(new h.window.MouseEvent('mouseleave'));
  return h;
}
const usdQuote = (day, rate = 40) => ({ provider: 'NBU', meta: { currencyCode: 'USD' }, values: [{ datetime: day, close: rate }] });

test('rebalance USD hover shares a lazy current-day quote, supports touch/keyboard and never writes financial data', async t => {
  for (const native of [false, true]) await t.test(native ? 'native' : 'web', async t => {
    const h = await currencyRebalance(t, { native });
    const before = JSON.stringify(h.eval('stateStore.getData()'));
    const writes = h.requests.filter(r => ['PUT', 'POST', 'DELETE'].includes(r.method)).length;
    let resolve, requested;
    const calls = [];
    // Exercise the real facade dispatch, including the phone adapter.
    const adapter = native ? h.window.mobileApi : h.eval('api');
    adapter.getCurrencyHistory = params => { requested = params; calls.push(params); return new Promise(done => { resolve = done; }); };
    assert.equal(calls.length, 0);
    h.enter(h.summary); h.enter(h.footer); await flush();
    assert.equal(calls.length, 1);
    assert.equal(requested.code, 'USD'); assert.equal(requested.startDate, requested.endDate);
    assert.match(h.summary.textContent, /Loading today/);
    resolve(usdQuote(requested.startDate)); await flush();
    for (const host of [h.summary, h.footer]) {
      assert.equal(host.querySelector('strong').textContent, '$25.00');
      assert.match(host.querySelector('[role="tooltip"]').textContent, /1 USD = 40 UAH/);
      h.leave(host); assert.equal(host.querySelector('strong').textContent, '₴1,000.00');
      host.click(); assert.equal(host.querySelector('strong').textContent, '$25.00');
      host.click(); assert.equal(host.querySelector('strong').textContent, '₴1,000.00');
      host.focus(); assert.equal(host.querySelector('strong').textContent, '$25.00');
      host.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(host.querySelector('strong').textContent, '₴1,000.00');
      host.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      assert.equal(host.querySelector('strong').textContent, '$25.00');
      host.blur();
    }
    await flush(); assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
    assert.equal(h.requests.filter(r => ['PUT', 'POST', 'DELETE'].includes(r.method)).length, writes);
    assert.deepEqual(h.errors, []);
  });
});

test('rebalance USD rejects unavailable, stale and invalid quotes, backs off and refreshes after Kyiv midnight', async t => {
  const h = await currencyRebalance(t);
  const RealDate = h.window.Date;
  let now = RealDate.parse('2026-10-18T20:59:00Z'); // 23:59 in Kyiv.
  h.window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  let result, count = 0;
  const days = [];
  h.eval('api').getCurrencyHistory = async params => { count++; days.push(params.startDate); return result(params.startDate); };
  const bad = [
    () => { throw new Error('Offline'); },
    day => usdQuote('2026-10-17'),
    day => ({ ...usdQuote(day), provider: 'fallback' }),
    day => ({ ...usdQuote(day), meta: { currencyCode: 'EUR' } }),
    ...[0, -40, '40', null].map(rate => day => usdQuote(day, rate)),
  ];
  for (let index = 0; index < bad.length; index++) {
    result = bad[index]; now += 31000;
    h.enter(h.summary); await flush();
    assert.equal(count, index + 1);
    assert.equal(h.summary.querySelector('strong').textContent, '₴1,000.00');
    assert.match(h.summary.textContent, /rate is unavailable/);
    h.leave(h.summary); h.enter(h.summary); await flush();
    assert.equal(count, index + 1, 'failed calls back off'); h.leave(h.summary);
  }
  result = day => usdQuote(day, 50); now = RealDate.parse('2026-10-19T20:59:00Z');
  h.enter(h.summary); await flush(); assert.equal(h.summary.querySelector('strong').textContent, '$20.00');
  assert.equal(days.at(-1), '2026-10-19'); h.leave(h.summary);
  now += 120000; result = day => usdQuote(day, 40);
  h.enter(h.summary); await flush(); assert.equal(h.summary.querySelector('strong').textContent, '$25.00');
  assert.equal(days.at(-1), '2026-10-20'); assert.deepEqual(h.errors, []);
});

test('late USD response cannot restore an invalidated rebalance total and a zero total remains valid', async t => {
  const h = await currencyRebalance(t, { locale: 'uk' });
  let resolve, day;
  h.eval('api').getCurrencyHistory = params => { day = params.startDate; return new Promise(done => { resolve = done; }); };
  h.summary.click(); await flush();
  const input = h.document.querySelector('[data-rebalance-group]');
  input.value = '40'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  resolve(usdQuote(day)); await flush();
  assert.equal(h.summary.querySelector('strong').textContent, '—');
  assert.equal(h.summary.hasAttribute('tabindex'), false);
  assert.equal(h.summary.querySelector('[role="tooltip"]').hidden, true);
  // The display layer must distinguish a valid zero from an absent calculation.
  h.window.FinoRebalanceCurrencyHover.update(0); h.summary.click(); await flush();
  assert.match(h.summary.querySelector('strong').textContent, /0,00/);
  assert.match(h.summary.querySelector('[role="tooltip"]').textContent, /НБУ/);
  assert.equal(h.summary.getAttribute('aria-pressed'), 'true'); assert.deepEqual(h.errors, []);
});

test('rebalance dashboard synchronizes controls, preserves calculations and never edits holdings', async t => {
  const initial = fixture();
  initial.assets.push({ id: 'bond', name: 'OVDP 4413', type: 'ovdp', isin: 'TEST', quantity: 10, purchasePrice: 1000, currentPrice: 1050, purchaseDate: '2026-01-01', currency: 'UAH' });
  initial.transactions.push({ id: 'bond-buy', assetId: 'bond', type: 'BUY', quantity: 10, amount: 10000, date: '2026-01-01', currency: 'UAH' });
  const h = await harness(t, { initial, charts: 'real' });
  h.document.querySelector('[data-section="rebalance"]').click(); await flush();
  const before = JSON.stringify(h.eval('stateStore.getData()'));
  const current = h.window.Chart.getChart('rebalance-current-chart');
  const currentValues = Array.from(current.data.datasets[0].data);
  assert.deepEqual(currentValues, [9600, 10500]);
  const inputs = () => Array.from(h.document.querySelectorAll('[data-rebalance-group]'));
  const set = (input, value) => { input.value = String(value); input.dispatchEvent(new h.window.Event('input', { bubbles: true })); };
  const button = h.document.querySelector('#calculate-rebalance');
  assert.equal(button.disabled, true);
  set(inputs()[0], 25);
  const slider = h.document.querySelector('[data-rebalance-slider]');
  assert.equal(slider.value, '25');
  set(slider, 50);
  assert.equal(inputs()[0].value, '50'); assert.equal(inputs()[1].value, '0');
  assert.equal(h.window.Chart.getChart('rebalance-current-chart'), current);
  assert.deepEqual(Array.from(current.data.datasets[0].data), currentValues);
  set(inputs()[1], 50); assert.equal(button.disabled, false);
  button.click();
  const rows = h.document.querySelectorAll('#rebalance-results tbody tr');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.rebalance-action').textContent, 'Buy');
  assert.equal(rows[1].querySelector('.rebalance-action').textContent, 'Hold');
  assert.equal(rows[0].cells[2].textContent, '₴900.00');
  assert.equal(rows[1].cells[2].textContent, '—');
  const plan = h.eval("calculateRebalancePlan([{groupId:'stock::smoke stock',percent:50},{groupId:'ovdp',percent:50}])");
  assert.equal(plan.totalToInvest, 900);
  assert.equal(h.document.querySelector('#rebalance-invest-value').textContent, '₴900.00');
  const target = h.window.Chart.getChart('rebalance-target-chart');
  assert.match(target.options.plugins.tooltip.callbacks.label({ dataIndex: 0 }), /10,500/);
  h.window.renderRebalanceCalculator();
  assert.equal(inputs()[0].value, '50'); assert.equal(h.document.querySelectorAll('#rebalance-results tbody tr').length, 2);
  set(inputs()[0], 0); set(inputs()[1], 100); button.click();
  assert.match(h.document.querySelector('#rebalance-results').textContent, /0% target remain/);
  assert.equal(h.document.querySelectorAll('#rebalance-results .is-sell').length, 0);
  set(inputs()[0], '33.3'); set(inputs()[1], '66.7');
  assert.equal(button.disabled, false); assert.equal(h.document.querySelectorAll('#rebalance-results tbody tr').length, 0);
  assert.equal(h.document.querySelector('#rebalance-invest-value').textContent, '—');
  set(inputs()[0], -1); assert.equal(button.disabled, true); assert.equal(inputs()[0].validity.valid, false);
  set(inputs()[0], 50.05); assert.equal(button.disabled, true);
  set(inputs()[0], 25); set(inputs()[1], 25);
  h.document.querySelector('#normalize-rebalance').click();
  assert.deepEqual(inputs().map(input => input.value), ['50', '50']);
  set(inputs()[0], 60); set(inputs()[1], 60);
  assert.equal(button.disabled, true);
  assert.match(h.document.querySelector('#rebalance-allocation-status').textContent, /20% over/);
  h.document.querySelector('#normalize-rebalance').click();
  assert.deepEqual(inputs().map(input => input.value), ['50', '50']);
  inputs().forEach(input => set(input, 0)); h.document.querySelector('#normalize-rebalance').click();
  assert.match(h.document.querySelector('#rebalance-allocation-status').textContent, /positive target/);
  assert.equal(button.disabled, true);
  set(inputs()[0], 50); set(inputs()[1], 50);
  h.document.querySelector('#add-rebalance-asset').click();
  const form = h.document.querySelector('#rebalance-asset-form');
  const name = '<img src=x onerror=alert(1)> Planned ETF';
  form.elements.name.value = name;
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(inputs().length, 3); assert.equal(inputs()[0].value, '50');
  assert.equal(h.document.querySelector('#rebalance-targets img'), null);
  assert.ok(h.window.Chart.getChart('rebalance-target-chart').data.labels.includes(name));
  h.document.querySelectorAll('[data-remove-rebalance]')[2].click();
  assert.equal(inputs().length, 2);
  h.document.querySelector('[data-remove-rebalance]').click();
  assert.equal(inputs().length, 1);
  assert.deepEqual(Array.from(h.window.Chart.getChart('rebalance-current-chart').data.datasets[0].data), currentValues);
  set(inputs()[0], 100); button.click();
  assert.equal(h.document.querySelectorAll('#rebalance-results .is-buy').length, 0);
  assert.equal(h.document.querySelectorAll('#rebalance-results .is-hold').length, 1);
  await h.window.FinoRebalanceDashboard.flush();
  const after = JSON.parse(JSON.stringify(h.eval('stateStore.getData()'))); delete after.rebalance;
  assert.equal(JSON.stringify(after), before);
  assert.equal(h.requests.some(request => request.route.startsWith('/api/') && request.route !== '/api/rebalance' && ['POST', 'PUT', 'DELETE'].includes(request.method)), false);
  assert.deepEqual(h.errors, []);
});

test('rebalance empty state, long names and all six locales remain usable', async t => {
  for (const locale of ['en', 'de', 'uk', 'es', 'pl', 'it']) await t.test(locale, async t => {
    const initial = fixture(); initial.assets[0].name = 'Stocks <Portfolio> ' + 'Long '.repeat(12);
    const h = await harness(t, { initial, locale, charts: 'real', styles: true });
    const originalName = initial.assets[0].name;
    assert.equal(h.document.querySelector('#rebalance-targets .rebalance-asset-name > span').textContent, originalName);
    for (const theme of ['dark', 'light', 'monochromatic', 'analog']) {
      const select = h.document.querySelector('#settings-theme-select');
      select.value = theme; select.dispatchEvent(new h.window.Event('change', { bubbles: true }));
      assert.equal(h.document.documentElement.dataset.theme, theme);
      const tokens = h.window.getComputedStyle(h.document.querySelector('#rebalance-section'));
      const current = h.window.Chart.getChart('rebalance-current-chart');
      const target = h.window.Chart.getChart('rebalance-target-chart');
      assert.equal(current.options.plugins.tooltip.backgroundColor, tokens.getPropertyValue('--surface').trim());
      assert.equal(current.options.plugins.tooltip.bodyColor, tokens.getPropertyValue('--text').trim());
      assert.equal(target.data.datasets[0].backgroundColor[0], current.data.datasets[0].backgroundColor[0]);
      assert.equal(current.data.datasets[0].backgroundColor[0], tokens.getPropertyValue('--rebalance-asset-1').trim());
      assert.equal(h.document.querySelector('#rebalance-targets .rebalance-color').style.backgroundColor, h.document.querySelector('#rebalance-legend .rebalance-color').style.backgroundColor);
      assert.equal(target.options.plugins.tooltip.callbacks.title([{ label: originalName }]), originalName);
    }
    h.document.querySelector('#normalize-rebalance').click();
    assert.equal(h.document.querySelector('#rebalance-allocation-status').textContent, h.window.FinoI18n.t('Enter at least one positive target before normalizing.'));
    const input = h.document.querySelector('[data-rebalance-group]');
    input.value = '100'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    h.document.querySelector('#calculate-rebalance').click();
    assert.equal(h.document.querySelector('#rebalance-results .rebalance-action').textContent, h.window.FinoI18n.t('Hold'));
    assert.equal(h.document.querySelector('#rebalance-results tbody [translate="no"]').textContent, originalName);
    assert.deepEqual(h.errors, []);
  });
  const empty = await harness(t, { initial: model.createEmptyState(), charts: 'real' });
  assert.equal(empty.document.querySelector('#calculate-rebalance').disabled, true);
  assert.equal(empty.document.querySelector('#rebalance-asset-count').textContent, '0');
  assert.equal(empty.document.querySelector('#rebalance-current-empty').hidden, false);
  assert.deepEqual(empty.errors, []);
});

test('rebalance keeps forty assets usable, invalidates outdated market results and works without charts', async t => {
  const initial = model.createEmptyState();
  for (let i = 0; i < 40; i++) {
    initial.assets.push({ id: 'asset-' + i, name: 'Long asset name ' + i, type: 'stock', quantity: 1, purchasePrice: 100, currentPrice: 100 + i, purchaseDate: '2026-01-01', currency: 'UAH' });
    initial.transactions.push({ id: 'buy-' + i, assetId: 'asset-' + i, type: 'BUY', quantity: 1, amount: 100, date: '2026-01-01', currency: 'UAH' });
  }
  const h = await harness(t, { initial, charts: 'real' });
  const current = h.window.Chart.getChart('rebalance-current-chart');
  const editor = Array.from(h.document.querySelectorAll('[data-rebalance-group]'));
  editor.forEach(input => { input.value = '2.5'; input.dispatchEvent(new h.window.Event('input', { bubbles: true })); });
  assert.equal(h.document.querySelector('#calculate-rebalance').disabled, false);
  assert.equal(h.window.Chart.getChart('rebalance-current-chart'), current);
  h.document.querySelector('#calculate-rebalance').click();
  assert.equal(h.document.querySelectorAll('#rebalance-results tbody tr').length, 40);
  h.eval('stateStore.getData().assets[0].currentPrice = 200'); h.window.renderRebalanceCalculator();
  assert.equal(h.document.querySelectorAll('#rebalance-results tbody tr').length, 0);
  assert.equal(h.document.querySelector('[data-rebalance-group]').value, '2.5');
  assert.deepEqual(h.errors, []);
  const withoutChart = await harness(t);
  assert.equal(withoutChart.document.querySelector('#rebalance-chart-status').hidden, false);
  const input = withoutChart.document.querySelector('[data-rebalance-group]'); input.value = '100'; input.dispatchEvent(new withoutChart.window.Event('input', { bubbles: true }));
  withoutChart.document.querySelector('#calculate-rebalance').click();
  assert.equal(withoutChart.document.querySelectorAll('#rebalance-results tbody tr').length, 1);
  assert.deepEqual(withoutChart.errors, []);
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

test('rebalance selections survive web reload, native restart and a round trip between adapters', async t => {
  const initial = fixture();
  initial.rebalance = { targets: { 'stock::smoke stock': 35, 'planned-etf': 65 }, plannedAssets: [{ id: 'planned-etf', label: 'Future ETF' }], excluded: [] };
  const h = await harness(t, { initial });
  const inputs = () => Array.from(h.document.querySelectorAll('[data-rebalance-group]'));
  assert.deepEqual(inputs().map(input => input.value), ['35', '65']);
  for (let i = 36; i <= 60; i++) {
    inputs()[0].value = String(i); inputs()[0].dispatchEvent(new h.window.Event('input', { bubbles: true }));
  }
  inputs()[1].value = '40'; inputs()[1].dispatchEvent(new h.window.Event('input', { bubbles: true }));
  h.window.dispatchEvent(new h.window.Event('pagehide'));
  await h.window.FinoRebalanceDashboard.flush();
  assert.deepEqual(h.stored().rebalance.targets, { 'stock::smoke stock': 60, 'planned-etf': 40 });
  assert.equal(h.requests.filter(item => item.route === '/api/rebalance').length, 1, 'slider movements coalesce into one write');
  const restarted = await harness(t, { initial: h.stored() });
  assert.deepEqual(Array.from(restarted.document.querySelectorAll('[data-rebalance-group]'), input => input.value), ['60', '40']);
  const phone = await harness(t, { native: true, initial: h.stored() });
  const first = phone.document.querySelector('[data-rebalance-group]');
  assert.equal(first.value, '60');
  first.value = '55'; first.dispatchEvent(new phone.window.Event('input', { bubbles: true }));
  await phone.window.FinoRebalanceDashboard.flush(); await phone.window.mobileApi.waitForSync();
  phone.document.querySelector('[data-remove-rebalance]').click();
  await phone.window.FinoRebalanceDashboard.flush(); await phone.window.mobileApi.waitForSync();
  const onPhone = await phone.window.mobileApi.getData({ sync: false });
  assert.deepEqual(Array.from(onPhone.rebalance.excluded), ['stock::smoke stock']);
  assert.equal(onPhone.rebalance.plannedAssets[0].label, 'Future ETF');
  assert.equal((await phone.window.mobileApi.getGoogleDriveStatus()).savedRemotely, false);
  const restoredPhone = await harness(t, { native: true, nativeStorage: phone.nativeStorage });
  assert.equal(restoredPhone.document.querySelectorAll('[data-rebalance-group]').length, 1);
  assert.equal(restoredPhone.document.querySelector('[data-rebalance-group]').value, '40');
  const backOnWeb = await harness(t, { initial: JSON.parse(JSON.stringify(onPhone)) });
  assert.equal(backOnWeb.document.querySelectorAll('[data-rebalance-group]').length, 1);
  assert.equal(backOnWeb.document.querySelector('[data-rebalance-group]').value, '40');
  for (const result of [h, restarted, phone, restoredPhone, backOnWeb]) assert.deepEqual(result.errors, []);
});

test('rebalance save failure keeps the editable draft, shows retry and never pretends it was saved', async t => {
  const h = await harness(t, { failRebalance: true });
  const before = JSON.stringify(h.stored());
  const input = h.document.querySelector('[data-rebalance-group]');
  input.value = '100'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  await h.window.FinoRebalanceDashboard.flush();
  assert.equal(JSON.stringify(h.stored()), before);
  assert.equal(h.eval('stateStore.getData().rebalance'), undefined);
  assert.equal(input.value, '100');
  assert.equal(h.document.querySelector('#rebalance-save-status').dataset.state, 'error');
  assert.equal(h.document.querySelector('#rebalance-save-retry').hidden, false);
  h.failRebalance(false); h.document.querySelector('#rebalance-save-retry').click();
  await h.window.FinoRebalanceDashboard.flush();
  assert.equal(h.stored().rebalance.targets['stock::smoke stock'], 100);
  assert.equal(h.document.querySelector('#rebalance-save-retry').hidden, true);
  assert.match(h.document.querySelector('#rebalance-save-status').textContent, /saved locally/);
  assert.deepEqual(h.errors, []);
});

test('rebalance concurrent edits require explicit reload and clean remote updates hydrate the editor', async t => {
  const h = await harness(t);
  const input = h.document.querySelector('[data-rebalance-group]');
  input.value = '100'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  const remote = h.stored(); remote.rebalance = { targets: { 'stock::smoke stock': 25 }, plannedAssets: [], excluded: [] };
  h.replaceStored(remote);
  await h.window.FinoRebalanceDashboard.flush();
  assert.equal(h.stored().rebalance.targets['stock::smoke stock'], 25);
  assert.equal(input.value, '100');
  assert.equal(h.document.querySelector('#rebalance-save-reload').hidden, false);
  h.document.querySelector('#rebalance-save-reload').click(); await flush();
  assert.equal(h.document.querySelector('[data-rebalance-group]').value, '25');
  assert.equal(h.document.querySelector('#rebalance-save-reload').hidden, true);
  const next = h.stored(); next.rebalance.targets['stock::smoke stock'] = 75;
  h.eval('stateStore').replaceData(next); h.window.renderRebalanceCalculator();
  assert.equal(h.document.querySelector('[data-rebalance-group]').value, '75');
  assert.deepEqual(h.errors, []);
});

test('analytics allocation uses the rebalance ring style and keeps its legend interactive in all themes', async t => {
  const h = await harness(t, { styles: true, charts: 'real' });
  const canvas = h.document.querySelector('#asset-allocation-chart');
  const chart = h.window.Chart.getChart(canvas);
  for (const theme of ['dark', 'light', 'monochromatic', 'analog']) {
    h.document.documentElement.dataset.theme = theme;
    h.window.renderAssetAllocationChart(); h.window.renderRebalanceCalculator();
    assert.equal(h.window.Chart.getChart(canvas), chart);
    const current = h.window.Chart.getChart('rebalance-current-chart');
    assert.equal(chart.options.cutout, current.options.cutout);
    assert.equal(chart.data.datasets[0].borderWidth, 2);
    assert.equal(chart.data.datasets[0].backgroundColor[0], current.data.datasets[0].backgroundColor[0]);
    assert.equal(chart.options.plugins.tooltip.backgroundColor, current.options.plugins.tooltip.backgroundColor);
    assert.equal(chart.options.plugins.tooltip.bodyColor, current.options.plugins.tooltip.bodyColor);
    assert.equal(h.document.querySelector('#asset-allocation-center').textContent, h.document.querySelector('#rebalance-current-center').textContent);
  }
  h.document.querySelector('#asset-allocation-legend button').click();
  assert.equal(chart.getDataVisibility(0), false);
  h.document.querySelector('#asset-allocation-legend button').click();
  assert.equal(chart.getDataVisibility(0), true);
  const mode = h.document.querySelector('#asset-allocation-mode'); mode.value = 'tools';
  mode.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.ok(chart.data.labels.includes('Unassigned'));
  assert.deepEqual(h.errors, []);
});

test('rebalance recovers a pending tab draft on immediate reload and does not overwrite divergent saved targets', async t => {
  const h = await harness(t, { failRebalance: true });
  const input = h.document.querySelector('[data-rebalance-group]');
  input.value = '100'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  const sessionDraft = h.window.sessionStorage.getItem('fino-rebalance-draft-v1');
  assert.equal(JSON.parse(sessionDraft).plan.targets['stock::smoke stock'], 100);
  const restarted = await harness(t, { initial: h.stored(), sessionDraft });
  assert.equal(restarted.document.querySelector('[data-rebalance-group]').value, '100');
  await restarted.window.FinoRebalanceDashboard.flush();
  assert.equal(restarted.stored().rebalance.targets['stock::smoke stock'], 100);
  assert.equal(restarted.window.sessionStorage.getItem('fino-rebalance-draft-v1'), null);
  const changed = h.stored(); changed.rebalance = { targets: { 'stock::smoke stock': 25 }, plannedAssets: [], excluded: [] };
  const conflict = await harness(t, { initial: changed, sessionDraft });
  assert.equal(conflict.document.querySelector('[data-rebalance-group]').value, '100');
  assert.equal(conflict.document.querySelector('#rebalance-save-reload').hidden, false);
  const conflictedInput = conflict.document.querySelector('[data-rebalance-group]');
  conflictedInput.value = '90'; conflictedInput.dispatchEvent(new conflict.window.Event('input', { bubbles: true }));
  await conflict.window.FinoRebalanceDashboard.flush();
  assert.equal(conflict.stored().rebalance.targets['stock::smoke stock'], 25);
  assert.equal(conflict.document.querySelector('#rebalance-save-reload').hidden, false);
  assert.deepEqual(restarted.errors, []); assert.deepEqual(conflict.errors, []);
});

test('native rebalance recovery never adopts another Google account draft', async t => {
  const h = await harness(t, { native: true });
  const input = h.document.querySelector('[data-rebalance-group]');
  input.value = '100'; input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  const draft = JSON.parse(h.window.sessionStorage.getItem('fino-rebalance-draft-v1'));
  const scope = JSON.parse(draft.scope); scope[1] = 'different@example.com'; draft.scope = JSON.stringify(scope);
  const other = await harness(t, { native: true, sessionDraft: JSON.stringify(draft) });
  assert.equal(other.document.querySelector('[data-rebalance-group]').value, '0');
  await other.window.FinoRebalanceDashboard.flush();
  assert.equal((await other.window.mobileApi.getData({ sync: false })).rebalance, undefined);
  assert.deepEqual(other.errors, []);
});
