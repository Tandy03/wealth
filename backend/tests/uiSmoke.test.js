const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { guardFinancialReads } = require('./helpers/readonlyStore');
const { loadModules, exposeRuntime } = require('./helpers/frontendModules');
const model = require('../../shared/state-model');
const frontend = path.join(__dirname, '../../frontend');
const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const fixture = () => ({ ...model.createEmptyState(), assets: [{ id: 'stock', name: 'Smoke Stock', type: 'stock', quantity: 2, purchasePrice: 100, currentPrice: 120, purchaseDate: '2026-01-01', currency: 'USD' }], transactions: [{ id: 'buy', assetId: 'stock', type: 'BUY', quantity: 2, amount: 200, date: '2026-01-01', currency: 'USD' }] });
for (const native of [false, true]) for (const locale of ['en', 'uk', 'de', 'es', 'pl', 'it']) {
  test(`portfolio share stays local, isolated and translated in ${native ? 'native' : 'web'} ${locale}`, async t => {
    const h = await harness(t, { native, locale, styles: true });
    const before = JSON.stringify(h.eval('stateStore.selectData()')), requests = h.requests.length;
    let calculations = 0, exports = 0;
    const build = h.window.FinoPortfolioShare.createReport;
    h.window.FinoPortfolioShare.createReport = options => { calculations++; return build(options); };
    h.window.FinoPortfolioShare.platform.png = () => { exports++; assert.fail('Opening/configuring the modal must not generate a bitmap'); };
    const button = h.document.querySelector('#portfolio-share-button');
    h.document.querySelector('#open-investments').click();
    assert.equal(button.nextElementSibling.id, 'add-asset-btn');
    assert.equal(calculations, 0);
    button.focus(); button.click(); await flush();
    const modal = h.document.querySelector('.portfolio-share-overlay'); assert.ok(modal);
    assert.equal(modal.querySelector('[data-share-period]').value, 'current');
    assert.equal(modal.querySelector('[data-share-metric="value"]').checked, false);
    assert.equal(modal.querySelector('[data-share-metric="invested"]').checked, false);
    assert.equal(modal.querySelector('h2').textContent, h.window.FinoI18n.t('Portfolio share card'));
    assert.ok(modal.querySelector('svg[width="1080"][height="1080"]'));
    assert.doesNotMatch(modal.querySelector('[data-share-preview]').innerHTML, /Smoke Stock|Private|undefined|NaN|Infinity/);
    const globalTheme = h.document.documentElement.dataset.theme;
    const colors = new Set();
    for (const theme of ['dark', 'light', 'monochromatic', 'analog']) {
      const select = modal.querySelector('[data-share-theme]'); select.value = theme; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); await flush();
      colors.add(modal.querySelector('[data-share-preview] svg rect').getAttribute('fill'));
      assert.equal(h.document.documentElement.dataset.theme, globalTheme);
    }
    assert.equal(colors.size, 4);
    assert.equal(calculations, 1, 'Theme-only changes reuse the report');
    for (const id of ['1m', 'ytd']) { const select = modal.querySelector('[data-share-period]'); select.value = id; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); }
    await flush();
    assert.ok(modal.querySelector('[data-share-preview]').textContent.includes(h.window.FinoI18n.t('Year to date')), 'The latest requested period owns the preview');
    for (const period of ['1m', '3m', '6m', '1y', 'ytd', 'all', 'current']) {
      const select = modal.querySelector('[data-share-period]'); select.value = period; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); await flush();
      assert.ok(modal.querySelector('[data-share-preview] svg'), period);
    }
    const period = modal.querySelector('[data-share-period]'); period.value = 'custom'; period.dispatchEvent(new h.window.Event('change', { bubbles: true })); await flush();
    assert.equal(modal.querySelector('[data-share-download]').disabled, true);
    assert.equal(modal.querySelector('[data-share-status]').textContent, h.window.FinoI18n.t('Choose valid dates ending no later than today.'));
    const from = modal.querySelector('[data-share-from]'); from.value = '2026-01-01'; from.dispatchEvent(new h.window.Event('change', { bubbles: true })); await flush();
    assert.ok(modal.querySelector('[data-share-preview] svg'));
    if (native) {
      assert.equal(modal.querySelector('[data-share-send]').disabled, true);
      assert.match(modal.querySelector('[data-share-status]').textContent, new RegExp(h.window.FinoI18n.t('Android file export needs a native bridge. Preview is available; file sharing is not yet verified.').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(h.document.querySelector('.portfolio-share-overlay'), null);
    assert.equal(h.document.activeElement, button);
    button.click(); await flush();
    assert.equal(h.document.querySelector('[data-share-period]').value, 'current');
    h.document.querySelector('[data-share-close]').click();
    assert.equal(exports, 0); assert.equal(h.requests.length, requests);
    assert.equal(JSON.stringify(h.eval('stateStore.selectData()')), before);
    assert.deepEqual(h.errors, []);
  });
}
test('portfolio share requires a fresh click for file sharing, handles cancellation, aborts obsolete exports and keeps Dashboard usable if the feature fails', async t => {
  const h = await harness(t);
  const button = h.document.querySelector('#portfolio-share-button');
  let exports = 0, shares = 0, urls = 0, clicks = 0, resolve;
  h.window.URL.createObjectURL = () => 'blob:' + ++urls; h.window.URL.revokeObjectURL = () => {};
  h.window.HTMLAnchorElement.prototype.click = () => { clicks++; };
  Object.defineProperty(h.window.navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(h.window.navigator, 'share', { configurable: true, value: async input => {
    shares++; assert.equal(input.files[0].name.startsWith('fino-portfolio-'), true);
    assert.deepEqual(Object.keys(input), ['files']); throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  } });
  h.window.FinoPortfolioShare.platform.png = async () => { exports++; return new h.window.Blob(['PNG'], { type: 'image/png' }); };
  button.click(); await flush();
  h.document.querySelector('[data-share-send]').click(); await flush();
  assert.equal(exports, 1); assert.equal(shares, 0);
  assert.equal(h.document.querySelector('[data-share-send]').textContent, 'Open share menu');
  h.document.querySelector('[data-share-send]').click(); await flush();
  assert.equal(exports, 1); assert.equal(shares, 1);
  assert.equal(h.document.querySelector('[data-share-status]').textContent, 'Sharing cancelled.');
  Object.defineProperty(h.window.navigator, 'canShare', { configurable: true, value: () => false });
  const setting = h.document.querySelector('[data-share-metric="count"]'); setting.checked = false; setting.dispatchEvent(new h.window.Event('change', { bubbles: true })); await flush();
  h.document.querySelector('[data-share-send]').click(); await flush(); assert.equal(clicks, 1);
  h.window.FinoPortfolioShare.platform.png = async () => { throw new Error('Internal export details must not reach the UI'); };
  h.document.querySelector('[data-share-download]').click(); await flush();
  assert.equal(h.document.querySelector('[data-share-status]').textContent, 'Could not create or share the PNG. Try again.');
  assert.equal(h.document.querySelector('[data-share-download]').disabled, false, 'Failed exports remain retryable');
  h.window.FinoPortfolioShare.platform.png = () => new Promise(done => { resolve = done; });
  h.document.querySelector('[data-share-download]').click(); h.document.querySelector('[data-share-download]').click();
  h.document.querySelector('[data-share-close]').click(); resolve(new h.window.Blob(['PNG'])); await flush();
  assert.equal(clicks, 1, 'Closing an export cannot initiate a late download');
  const feature = h.window.FinoPortfolioShare.view; h.window.FinoPortfolioShare.view = null;
  // The launcher must tolerate an unavailable optional bundle even after a previous session.
  button.click(); await flush(); assert.equal(h.document.querySelector('.portfolio-share-overlay'), null);
  assert.equal(h.document.querySelector('#notice-message').textContent, 'Portfolio share is unavailable.');
  h.window.FinoPortfolioShare.view = feature;
  assert.doesNotThrow(() => h.window.ui.dashboard.render());
  assert.deepEqual(h.errors, []);
});
for (const locale of ['en', 'uk', 'de', 'es', 'pl', 'it']) {
  test(`native Portfolio Share opens the system flow in one click with truthful localized results (${locale})`, async t => {
    let complete, calls = 0;
    const pngPlugin = { savePng: () => { calls++; return new Promise(resolve => { complete = resolve; }); }, sharePng: async () => { calls++; return { status: 'dialog-closed', opened: true, deliveryConfirmed: false }; } };
    const h = await harness(t, { native: true, locale, pngPlugin });
    // jsdom has no Blob.arrayBuffer; use the browser-equivalent Node Blob and a
    // deterministic FileReader. Android still validates the complete PNG.
    h.window.File = class { constructor() { assert.fail('Android export must reuse its Blob without creating a second File.'); } };
    h.window.FileReader = class {
      readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'); this.onload?.(); }); }
      abort() { this.onabort?.(); }
    };
    const bytes = new Uint8Array(64); bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
    new DataView(bytes.buffer).setUint32(16,1080); new DataView(bytes.buffer).setUint32(20,1080);
    let exports = 0;
    h.window.FinoPortfolioShare.platform.png = async () => { exports++; return new Blob([bytes], { type: 'image/png' }); };
    const before = JSON.stringify(h.eval('stateStore.selectData()')), requests = h.requests.length;
    const translated = key => h.window.FinoI18n.t(key);
    h.document.querySelector('#portfolio-share-button').click(); await flush();
    const save = h.document.querySelector('[data-share-download]'), share = h.document.querySelector('[data-share-send]');
    save.click(); save.click(); await flush();
    assert.equal(calls, 1); assert.equal(exports, 1); assert.equal(save.disabled, true); assert.equal(share.disabled, true);
    assert.equal(h.document.querySelector('[data-share-status]').textContent, translated('Choose where to save the PNG.'));
    complete({ status: 'cancelled', cancelled: true, saved: false }); await flush();
    assert.equal(h.document.querySelector('[data-share-status]').textContent, translated('PNG operation cancelled.'));
    save.click(); await flush(); complete({ status: 'saved', saved: true }); await flush();
    assert.equal(h.document.querySelector('[data-share-status]').textContent, translated('PNG saved.'));
    share.click(); await flush();
    assert.equal(calls, 3); assert.equal(exports, 3);
    assert.equal(h.document.querySelector('[data-share-status]').textContent, translated('Share menu closed. Delivery is not confirmed.'));
    for (const [code, key] of [['NO_SHARE_TARGET', 'No app is available to share PNG files.'], ['SHARE_CACHE_FULL', 'Temporary share storage is full. Try again later.'], ['OPERATION_INTERRUPTED', 'PNG operation interrupted. Please try again.'], ['STORAGE_FAILURE', 'Could not create or share the PNG. Try again.']]) {
      pngPlugin.sharePng = async () => { throw Object.assign(new Error('Private URI and error details'), { code }); };
      share.click(); await flush(); assert.equal(h.document.querySelector('[data-share-status]').textContent, translated(key));
      if (locale !== 'en') assert.notEqual(translated(key), key);
      assert.equal(share.disabled, false);
    }
    assert.equal(JSON.stringify(h.eval('stateStore.selectData()')), before); assert.equal(h.requests.length, requests); assert.deepEqual(h.errors, []);
    h.document.querySelector('[data-share-close]').click();
  });
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function registerHarnessCleanup(t, dom, observers) {
  // Test hooks outlive individual cases. Release their only DOM reference after
  // teardown instead of retaining the complete application closure until EOF.
  let resources = { dom, observers };
  t.after(async () => {
    const closing = resources; resources = null;
    await closing.dom.window.FinoRebalanceDashboard?.flush();
    closing.observers.forEach(observer => observer.disconnect());
    closing.observers.length = 0;
    await new Promise(resolve => setTimeout(resolve, 40));
    closing.dom.window.close();
  });
}
async function harness(t, { initial = fixture(), blockMarkets = false, locale = 'en', charts = false, failWallet = false, failRebalance = false, failPayments = false, sessionDraft, native = false, nativeStorage: restoredStorage, macroFailureOnce = false, styles = false, compact = false, bootFromEvent = false, browserStorage, syncPreview, outbox, transferPicker, pngPlugin } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  Object.defineProperty(window, 'crypto', { value: require('node:crypto').webcrypto });
  window.TextEncoder = TextEncoder;
  if (styles) {
    const style = window.document.createElement('style');
    style.textContent = ['style.css', 'rebalance.css', 'asset-detail.css', 'portfolio-share.css', 'calendar.css', 'mobile-navigation.css'].map(file => fs.readFileSync(path.join(frontend, 'css', file), 'utf8')).join('\n');
    window.document.head.append(style);
  }
  window.localStorage.setItem('fino-language', locale);
  for (const [key, value] of browserStorage || []) window.localStorage.setItem(key, value);
  if (sessionDraft) window.sessionStorage.setItem('fino-rebalance-draft-v1', sessionDraft);
  const observers = [];
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  registerHarnessCleanup(t, dom, observers);
  if (window.document.readyState === 'loading') await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  window.console = { log() {}, info() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) };
  window.matchMedia = query => ({ matches: compact && query === '(max-width: 700px)', addEventListener() {} });
  window.scrollTo = () => {}; // jsdom has no layout or scrolling implementation.
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
    window.Capacitor = { isNativePlatform: () => true, Plugins: {
      FinoStorage: {
        get: async ({ key }) => ({ value: nativeStorage.get(key) || null }),
        set: async ({ key, value }) => nativeStorage.set(key, value),
        remove: async ({ key }) => nativeStorage.delete(key),
      },
      GoogleDriveAuth: { getAccessToken: async () => { throw Object.assign(new Error('Google authorization was cancelled.'), { code: 'AUTHORIZATION_REQUIRED' }); } },
      PortfolioTransfer: transferPicker,
      PortfolioShare: pngPlugin,
    } };
    window.FINO_MOBILE_CONFIG = { proxyUrl: 'https://script.google.com/macros/s/mock/exec', proxyToken: 'mock-token' };
  }
  let queue = Promise.resolve();
  const repository = {
    readData: async () => structuredClone(stored),
    saveData: async data => { stored = model.normalizeState(data); },
    writeLocalData: async data => { stored = model.normalizeState(data); return { savedLocally: true, savedRemotely: false, backupSaved: false }; },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  };
  const assets = require('../domain/assetService').createService(repository);
  const purchases = require('../domain/purchaseService').createService(repository);
  const sales = require('../domain/saleService').createService(repository);
  const payments = require('../domain/paymentService').createService(repository);
  const wallet = require('../domain/walletService').createService(repository);
  const rebalance = require('../domain/rebalanceService').createService(repository);
  const requests = [];
  let rebalanceFailure = failRebalance, walletFailure = failWallet;
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
    else if (route === '/api/portfolio/export') data = await require('../domain/portfolioTransferService').createService(repository).exportPortfolio();
    else if (route === '/api/portfolio/import/preview' || route === '/api/portfolio/import') {
      try {
        const service = require('../domain/portfolioTransferService').createService(repository);
        data = route.endsWith('/preview') ? await service.previewPortfolioImport(body.backup) : await service.restorePortfolio(body);
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, category: error.category }), { status: error.status || 500, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'transfer-test' } });
      }
    }
    else if (route === '/api/sync/status') data = { connected: false, enabled: false };
    else if (route === '/api/sync/preview') data = syncPreview || await require('../../shared/sync-model').comparison(stored, stored);
    else if (route === '/api/sync/google-drive') data = { success: true, action: body.action, status: { connected: true, enabled: true, state: 'sync-confirmed', remoteConfirmed: true } };
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
    else if (route === '/api/assets' && method === 'POST') data = await assets.createAsset(body);
    else if (/\/api\/assets\/.+\/buy$/.test(route)) data = await purchases.buyMoreAsset(route.split('/')[3], body);
    else if (route === '/api/sales' && method === 'POST') data = await sales.sellAsset(body);
    else if (/\/api\/payments\/.+\/received$/.test(route)) {
      if (failPayments) return new Response(JSON.stringify({ error: 'Storage unavailable.', code: 'STORAGE_FAILURE', category: 'storage' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'payment-test-id' } });
      data = await payments.markPaymentReceived(route.split('/')[3]);
    }
    else if (route === '/api/wallet' && method === 'PUT') {
      if (walletFailure) return new Response(JSON.stringify({ error: 'Storage unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'wallet-request-id' } });
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
  const modules = loadModules(dom.getInternalVMContext());
  const beforeGlobals = new Set(Object.keys(window));
  const runtime = modules.createFrontend(window, { Chart: window.Chart, config: window.FINO_MOBILE_CONFIG || {}, guardStore: guardFinancialReads });
  const app = exposeRuntime(window, runtime, dom.getInternalVMContext());
  if (outbox) Object.assign(runtime.api.outbox, outbox);
  if (bootFromEvent) {
    window.document.addEventListener('DOMContentLoaded', runtime.init, { once: true });
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flush();
  } else await runtime.init();
  if (native) await runtime.mobileApi.waitForSync();
  await flush();
  const leaked = Object.keys(window).filter(key => !beforeGlobals.has(key) && Object.hasOwn(runtime, key));
  assert.deepEqual(leaked, [], 'Application services must remain module-scoped.');
  return { window: app.window, document: window.document, errors, requests, chartCalls, nativeStorage,
    browserStorage: () => new Map(Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index); return [key, window.localStorage.getItem(key)];
    })), expireSession: () => { sessionValid = false; },
    failRebalance: value => { rebalanceFailure = value; }, failWallet: value => { walletFailure = value; }, replaceStored: next => { stored = model.normalizeState(next); },
    stored: () => structuredClone(stored), eval: app.eval };
}

for (const native of [false, true]) for (const locale of ['en', 'de', 'uk', 'es', 'pl', 'it']) {
  test(`portfolio files require explicit export and checked restore in ${native ? 'native' : 'web'} ${locale}`, async t => {
    const transfer = require('../../shared/portfolio-transfer');
    const backup = await transfer.createExport(fixture());
    let selected = JSON.stringify(backup), downloaded = null, saves = 0;
    const h = await harness(t, { native, locale, initial: model.createEmptyState(), transferPicker: {
      exportFile: async ({ text }) => { saves++; downloaded = text; return { saved: true }; },
      importFile: async () => ({ text: selected }),
    } });
    h.window.URL.createObjectURL = blob => { downloaded = blob; return 'blob:synthetic-export'; };
    h.window.URL.revokeObjectURL = () => {};
    h.window.HTMLAnchorElement.prototype.click = function () { assert.match(this.download, /^fino-portfolio-.*\.json$/); saves++; };
    const settle = async () => {
      for (let i = 0; i < 100; i++) {
        await flush();
        if (!h.document.querySelector('#portfolio-import').disabled || h.document.querySelector('#notice-modal').classList.contains('open')) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail('Portfolio transfer did not settle');
    };
    const choose = async text => {
      selected = text;
      h.document.querySelector('#portfolio-import').click();
      if (!native) {
        const input = h.document.querySelector('#portfolio-import-file');
        Object.defineProperty(input, 'files', { configurable: true, value: [new h.window.File([text], 'synthetic.json', { type: 'application/json' })] });
        input.dispatchEvent(new h.window.Event('change', { bubbles: true }));
      }
      await settle();
    };
    const tr = h.window.FinoI18n.t, preview = h.document.querySelector('#portfolio-import-preview');
    assert.equal(saves, 0); assert.equal(downloaded, null);
    assert.equal(h.requests.filter(request => request.route.startsWith('/api/portfolio/')).length, 0);
    h.document.querySelector('[data-open-settings]').click();
    assert.equal(h.document.querySelector('#portfolio-transfer h3').textContent, tr('Portfolio file'));
    await choose(JSON.stringify(backup));
    assert.equal(preview.hidden, false);
    assert.equal(h.eval('stateStore.getData().assets.length'), 0);
    assert.match(h.document.querySelector('#portfolio-import-checksum').textContent, new RegExp(backup.checksum));
    assert.equal(h.document.querySelector('#portfolio-transfer-status').textContent, tr('Checksum and document validation passed. Nothing has been restored yet.'));
    h.document.querySelector('#portfolio-import-cancel').click(); assert.equal(preview.hidden, true);
    assert.equal(h.eval('stateStore.getData().assets.length'), 0);
    await choose(JSON.stringify(backup));
    h.document.querySelector('#portfolio-import-confirm').click(); await settle();
    assert.equal(h.eval('stateStore.getData().assets.length'), 1, h.document.querySelector('#notice-message').textContent);
    assert.equal(h.eval('stateStore.getData().assets[0].name'), 'Smoke Stock');
    assert.equal(preview.hidden, true);
    assert.equal(h.document.querySelector('#portfolio-transfer-status').textContent, tr('Portfolio saved locally. Google Drive upload is not confirmed.'));
    const before = JSON.stringify(h.eval('stateStore.getData()'));
    h.document.querySelector('#portfolio-export').click(); await flush();
    assert.equal(h.document.querySelector('#notice-modal').classList.contains('open'), true);
    assert.equal(downloaded, null); assert.equal(saves, 0);
    assert.match(h.document.querySelector('#notice-message').textContent, new RegExp(tr('This file contains unencrypted financial data. Save it in a trusted location and check it before removing the app. Continue?').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    h.document.querySelector('#notice-cancel').click(); await settle(); assert.equal(saves, 0);
    h.document.querySelector('#portfolio-export').click(); await flush();
    h.document.querySelector('#notice-ok').click(); await settle();
    assert.equal(saves, 1);
    const text = typeof downloaded === 'string' ? downloaded : await new Promise((resolve, reject) => {
      const reader = new h.window.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(downloaded);
    });
    assert.equal((await transfer.validateExport(text)).data.assets[0].name, 'Smoke Stock');
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before, 'Export must be read-only');
    const damaged = JSON.parse(selected); damaged.document.assets[0].quantity++;
    await choose(JSON.stringify(damaged));
    assert.equal(preview.hidden, true);
    assert.ok(h.document.querySelector('#notice-message').textContent.includes(tr('Portfolio checksum does not match. The file may be damaged.')));
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
    h.document.querySelector('#notice-ok').click(); await settle();
    await choose(JSON.stringify(backup));
    assert.equal(preview.hidden, true);
    assert.ok(h.document.querySelector('#notice-message').textContent.includes(tr('Restore requires an empty portfolio. Existing data was preserved.')));
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
    assert.deepEqual(h.errors, []);
  });
}

for (const native of [false, true]) {
  test(`FX refresh renders only the visible screen and hidden screens refresh on entry in ${native ? 'native' : 'web'}`, async t => {
    const h = await harness(t, { native });
    const before = JSON.stringify(h.eval('stateStore.getData()'));
    const counts = {};
    for (const [owner, method] of [['asset', 'render'], ['dashboard', 'render'], ['portfolio', 'render'], ['transactions', 'render'], ['wallet', 'render'], ['calculators', 'render'], ['calculators', 'rebalance']]) {
      const render = h.window.ui[owner][method];
      h.window.ui[owner][method] = (...args) => { const key = owner + '.' + method; counts[key] = (counts[key] || 0) + 1; return render(...args); };
    }
    const refresh = () => {
      for (const key of Object.keys(counts)) delete counts[key];
      h.eval('stateStore.setUI({ marketRevision: (stateStore.getState().marketRevision || 0) + 1 })');
    };
    refresh(); assert.deepEqual(counts, { 'wallet.render': 1 });
    h.document.querySelector('#open-investments').click();
    for (const [section, renderer] of [['dashboard', 'dashboard.render'], ['portfolio', 'portfolio.render'], ['transactions', 'transactions.render'], ['analytics', 'calculators.render'], ['rebalance', 'calculators.rebalance']]) {
      h.document.querySelector(`[data-section="${section}"]`).click();
      refresh(); assert.deepEqual(counts, { [renderer]: 1 }, section);
    }
    h.window.ui.asset.open(['stock']);
    refresh(); assert.deepEqual(counts, { 'asset.render': 1 });
    h.document.querySelector('[data-section="dashboard"]').click();
    const previous = h.document.querySelector('#stat-value').textContent;
    // FX data is external UI metadata. A hidden financial view stays untouched
    // until selected; selecting it must use the newest FX and not stale markup.
    h.document.querySelectorAll('#investments-app .page-section').forEach(page => page.classList.toggle('active', page.id === 'market-section'));
    h.eval('EXCHANGE_RATES.USD = 55'); refresh();
    assert.deepEqual(counts, {});
    assert.equal(h.document.querySelector('#stat-value').textContent, previous);
    h.document.querySelector('[data-section="dashboard"]').click();
    assert.notEqual(h.document.querySelector('#stat-value').textContent, previous);
    h.document.querySelector('[data-section="portfolio"]').click();
    assert.equal(counts['portfolio.render'], 1);
    h.document.querySelector('[data-section="transactions"]').click();
    assert.equal(counts['transactions.render'], 1);
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
    assert.deepEqual(h.errors, []);
  });
  for (const locale of ['en', 'de', 'uk', 'es', 'pl', 'it']) {
    test(`command recovery translates complete messages and preserves original actions in ${native ? 'native' : 'web'} ${locale}`, async t => {
      const methods = ['createAsset', 'buyMoreAsset', 'createSale', 'createTransaction', 'createPayment', 'markPaymentReceived', 'createCalendarNote', 'mergeAssets'];
      const labels = ['Create asset', 'Buy asset', 'Sell asset', 'Create transaction', 'Create payment', 'Receive payment', 'Create calendar note', 'Merge assets'];
      const states = ['queued', 'in-flight', 'outcome-unknown', 'confirmed', 'rejected', 'conflict', 'confirmed', 'confirmed'];
      const messages = ['Saved locally; not sent', 'Waiting for confirmation', 'Result unknown; recover the original request', 'Confirmed; saved response retained locally', 'Rejected; review the request', 'Conflict; review before continuing', 'Already recorded; replay result expired. Reload the portfolio to review it.', 'Confirmed; saved response retained locally'];
      let result = { scope: 'recovery-test', entries: methods.map((method, i) => ({ operationId: 'original-' + i, method, state: states[i], ...(i === 6 ? { lastErrorCode: 'OPERATION_RESULT_EXPIRED' } : {}) })) };
      const retries = [], dismissed = [];
      const h = await harness(t, { native, locale, outbox: {
        list: async () => result,
        retry: async (id, scope) => { retries.push([id, scope]); },
        dismiss: async (id, scope) => { dismissed.push([id, scope]); },
      } });
      const panel = h.document.querySelector('#command-recovery'), tr = h.window.FinoI18n.t;
      assert.equal(panel.querySelector('strong').textContent, tr('Command recovery'));
      const rows = [...panel.querySelectorAll('.command-recovery-row')];
      assert.equal(rows.length, 8);
      rows.forEach((row, i) => {
        assert.ok(row.querySelector('span').textContent.startsWith(tr(labels[i]) + ' — ' + tr(messages[i])));
        if (locale !== 'en') { assert.notEqual(tr(labels[i]), labels[i]); assert.notEqual(tr(messages[i]), messages[i]); }
      });
      assert.equal(rows[1].querySelector('button'), null);
      assert.equal(rows[0].querySelector('button').textContent, tr('Retry original command'));
      rows[0].querySelector('button').click(); await flush();
      assert.deepEqual(retries, [['original-0', 'recovery-test']]);
      panel.querySelectorAll('.command-recovery-row')[6].querySelector('button').click(); await flush();
      assert.deepEqual(dismissed, [['original-6', 'recovery-test']]);
      assert.ok(panel.textContent.includes('OPERATION_RESULT_EXPIRED'));
      result = { corrupt: true, code: '<probe>', entries: [] };
      h.document.dispatchEvent(new h.window.CustomEvent('fino:outbox-changed')); await flush();
      assert.equal(panel.querySelector('p').textContent, h.window.FinoI18n.format('Local recovery data is damaged and has been preserved. No commands will be sent. Code: {code}', { code: '<probe>' }));
      assert.equal(panel.querySelector('probe'), null);
      assert.equal(panel.querySelector('button'), null);
      assert.equal(h.eval('stateStore.getData().assets.length'), 1);
      assert.deepEqual(h.errors, []);
    });
  }
}

for (const native of [false, true]) {
  test(`profit periods, valuation quality and concentration remain consistent in ${native ? 'offline native' : 'web'} UI`, async t => {
    const initial = fixture(), today = new Date().toISOString().slice(0, 10);
    initial.assets[0].purchaseDate = '2025-01-01'; initial.assets[0].priceUpdatedAt = today;
    initial.assets[0].issuer = '<img src=x onerror=alert(1)>'; initial.assets[0].sector = 'Technology';
    initial.transactions[0].date = '2025-01-01';
    initial.assets.push({ id:'unquoted', name:'Unquoted', type:'stock', quantity:1, purchasePrice:100, purchaseDate:'2025-01-01', currency:'UAH' });
    initial.transactions.push({ id:'other-buy', assetId:'unquoted', type:'BUY', quantity:1, amount:100, date:'2025-01-01', currency:'UAH' });
    initial.payments.push({ id:'income', assetId:'stock', type:'DIVIDEND', date:'2026-01-01', receivedDate:'2026-01-02', received:true, amount:10, currency:'USD' },
      { id:'later', assetId:'stock', type:'COUPON', date:'2026-01-01', receivedDate:'2026-03-01', status:'paid', amount:5, currency:'USD' });
    const h = await harness(t, { initial, native, compact:true });
    assert.equal(h.document.querySelector('#stat-return').textContent, 'Incomplete');
    assert.equal(h.document.querySelector('#stat-xirr-label').textContent, 'XIRR');
    assert.equal(h.document.querySelectorAll('#reinvestment-scenarios li').length, 0);
    assert.match(h.document.querySelector('#reinvestment-status').textContent, /Incomplete data/);
    assert.match(h.document.querySelector('#reinvestment-observation').textContent, /365 calendar days/);
    h.document.querySelector('[data-section="analytics"]').click();
    h.document.querySelector('#profit-from').value = '2026-01-01';
    h.document.querySelector('#profit-to').value = '2026-01-31';
    h.document.querySelector('#profit-to').dispatchEvent(new h.window.Event('change'));
    await flush();
    const amount = h.eval('money(createRenderServices(stateStore.getState()).calculateProfit("2026-01-01","2026-01-31").dividends)');
    assert.ok(h.document.querySelector('#profit-dividends').textContent.endsWith(amount));
    assert.ok(h.document.querySelector('#profit-coupons').textContent.endsWith(h.eval('money(0)')));
    assert.equal(h.document.querySelector('#profit-roi'),null);
    assert.match(h.document.querySelector('#profit-report-method').textContent,/Current unrealized result is separate/);
    assert.match(h.document.querySelector('#profit-current-note').textContent,/outside the selected period/);
    assert.match(h.document.querySelector('#concentration-summary').textContent,/excluded positions: 1/);
    assert.equal(h.document.querySelector('#concentration-groups img'),null);
    assert.match(h.document.querySelector('#concentration-groups').textContent,/<img src=x/);
    const requests = h.requests.length;
    const select = h.document.querySelector('#concentration-basis'); select.value='cost'; select.dispatchEvent(new h.window.Event('change'));
    await flush();
    assert.match(h.document.querySelector('#concentration-summary').textContent,/excluded positions: 0/);
    assert.match(h.document.querySelector('#concentration-groups').textContent,/Unquoted/);
    assert.equal(h.requests.length,requests,'changing analytic basis must not issue network requests');
    h.eval('renderReinvestmentForecast({data:null}, {})');
    assert.equal(h.document.querySelector('#reinvestment-scenarios').children.length,0);
    assert.equal(h.document.querySelector('#reinvestment-fx').textContent,'');
    assert.deepEqual(h.errors,[]);
  });
}

for (const native of [false, true]) for (const locale of ['en','uk']) {
  test(`regular-income card explains its records, daily capital, target FX and scenarios without writes in ${native?'native':'web'} ${locale}`, async t => {
    const today=require('../../frontend/js/analytics/values').getDateString();
    const firstDate=new Date(Date.parse(today)-364*86400000).toISOString().slice(0,10);
    const initial=fixture();initial.assets[0]={...initial.assets[0],name:'Dividend <img src=x>',currency:'UAH',quantity:100,purchaseDate:firstDate};
    initial.transactions[0]={...initial.transactions[0],currency:'UAH',quantity:100,amount:10000,date:firstDate};
    initial.payments.push({id:'regular',assetId:'stock',type:'DIVIDEND',status:'received',amount:1200,currency:'UAH',date:today});
    const h=await harness(t,{initial,native,locale,compact:true});
    const before=h.eval('JSON.stringify(stateStore.getData())'),requests=h.requests.length;
    h.eval(`stateStore.setUI({exchangeRateDate:${JSON.stringify(today)},exchangeRateSource:'NBU',exchangeRateStale:false});renderDashboard();`);
    await flush();
    assert.equal(h.document.querySelectorAll('#reinvestment-scenarios li').length,3);
    assert.equal(h.document.querySelector('#reinvestment-annual-yield').textContent,'12.00%');
    assert.ok(h.document.querySelector('#reinvestment-income').textContent.endsWith(h.eval('money(1200)')));
    assert.ok(h.document.querySelector('#reinvestment-average-capital').textContent.endsWith(h.eval('money(10000)')));
    assert.match(h.document.querySelector('#reinvestment-observation').textContent,/365/);
    assert.match(h.document.querySelector('#reinvestment-fx').textContent,/NBU/);
    assert.ok(h.document.querySelector('#reinvestment-fx').textContent.includes(today));
    assert.equal(h.document.querySelectorAll('#reinvestment-receipts li').length,1);
    assert.match(h.document.querySelector('#reinvestment-receipts').textContent,/<img src=x>/);
    assert.equal(h.document.querySelector('.reinvestment-stat-card img'),null);
    const assumptions=h.document.querySelector('.income-forecast-details').textContent;
    assert.match(assumptions,locale==='en'?/not market value/:/не ринкова вартість/);
    assert.match(assumptions,locale==='en'?/unrecorded tax/:/необліковані податки/);
    h.eval('stateStore.setUI({exchangeRateDate:null,exchangeRateSource:null});renderReinvestmentForecast();');
    await flush();
    assert.equal(h.document.querySelector('#stat-reinvestment').textContent,'—');
    assert.equal(h.document.querySelector('#reinvestment-required-capital').textContent,'—');
    assert.equal(h.document.querySelectorAll('#reinvestment-scenarios li').length,0);
    assert.equal(h.eval('JSON.stringify(stateStore.getData())'),before);
    assert.equal(h.requests.length,requests);
    assert.deepEqual(h.errors,[]);
  });
}

for (const native of [false,true]) for (const locale of ['en','uk','de','es','pl','it']) {
  test(`missing income is unavailable, independently of capital, and recovers without stale scenarios in ${native?'native':'web'} ${locale}`,async t=>{
    const today=require('../../frontend/js/analytics/values').getDateString();
    const firstDate=new Date(Date.parse(today)-364*86400000).toISOString().slice(0,10),initial=fixture();
    initial.assets[0]={...initial.assets[0],currency:'UAH',quantity:100,purchaseDate:firstDate};
    initial.transactions[0]={...initial.transactions[0],currency:'UAH',quantity:100,amount:10000,date:firstDate};
    initial.payments.push({id:'regular',assetId:'stock',type:'DIVIDEND',status:'planned',amount:1200,currency:'UAH',date:today});
    const h=await harness(t,{initial,native,locale,compact:true}),requests=h.requests.length;
    h.eval(`stateStore.setUI({exchangeRateDate:${JSON.stringify(today)},exchangeRateSource:'NBU',exchangeRateStale:false});renderReinvestmentForecast();`);
    await flush();
    const assertUnavailable=()=>{
      for(const id of ['reinvestment-income','reinvestment-annual-yield','reinvestment-required-capital','stat-reinvestment'])assert.equal(h.document.getElementById(id).textContent,'—',id);
      assert.ok(h.document.getElementById('stat-average-monthly-profit').textContent.endsWith('—'));
      assert.equal(h.document.querySelectorAll('#reinvestment-scenarios li').length,0);
      assert.equal(h.document.querySelector('#reinvestment-range').textContent,'');assert.equal(h.document.querySelector('#reinvestment-excess').textContent,'');
    };
    const message=h.window.FinoI18n.t('No confirmed regular-income receipts in the observation period. Income-based metrics are unavailable.');
    assertUnavailable();assert.equal(h.document.querySelector('#reinvestment-status').textContent,message);
    for(const id of ['reinvestment-average-capital','reinvestment-current-capital'])assert.equal(h.document.getElementById(id).textContent,h.eval('money(10000)'));
    assert.equal(h.document.querySelector('#reinvestment-target').textContent,h.eval('money(1000*EXCHANGE_RATES.USD)'));
    assert.match(h.document.querySelector('#reinvestment-observation').textContent,/365/);assert.match(h.document.querySelector('#reinvestment-fx').textContent,/NBU/);
    const before=h.eval('JSON.stringify(stateStore.getData())');h.eval('renderReinvestmentForecast()');assert.equal(h.eval('JSON.stringify(stateStore.getData())'),before);
    h.eval('stateStore.updateData(draft=>{draft.payments[0].status="received";draft.payments[0].amount=0;});renderReinvestmentForecast();');await flush();
    assertUnavailable();assert.ok(h.document.querySelector('#reinvestment-status').textContent.startsWith(h.window.FinoI18n.t('Regular-income receipt data is invalid or cannot be valued. Income-based metrics are unavailable.')));
    for(const id of ['reinvestment-average-capital','reinvestment-current-capital'])assert.equal(h.document.getElementById(id).textContent,h.eval('money(10000)'));
    h.eval('stateStore.updateData(draft=>{draft.payments[0].amount=1200;});renderReinvestmentForecast();');await flush();
    assert.equal(h.document.querySelector('#reinvestment-income').textContent,h.eval('money(1200)'));
    assert.equal(h.document.querySelectorAll('#reinvestment-scenarios li').length,3);
    h.eval('stateStore.updateData(draft=>{draft.payments[0].status="planned";});renderReinvestmentForecast();');await flush();
    assertUnavailable();assert.equal(h.document.querySelector('#reinvestment-status').textContent,message);
    assert.equal(h.requests.length,requests);assert.deepEqual(h.errors,[]);
  });
}

test('the income card explains both FX and 82-day history blockers, then keeps the history warning after FX recovers', async t => {
  const today=require('../../frontend/js/analytics/values').getDateString();
  const firstDate=new Date(Date.parse(today)-81*86400000).toISOString().slice(0,10), initial=fixture();
  initial.assets[0]={...initial.assets[0],currency:'UAH',quantity:100,purchaseDate:firstDate};
  initial.transactions[0]={...initial.transactions[0],currency:'UAH',quantity:100,amount:10000,date:firstDate};
  initial.payments.push({id:'regular',assetId:'stock',type:'DIVIDEND',status:'received',amount:307.8,currency:'UAH',date:today});
  const h=await harness(t,{initial,compact:true});
  assert.match(h.document.querySelector('#reinvestment-status').textContent,/Incomplete data.*82.*90/);
  assert.equal(h.document.querySelector('#reinvestment-income').textContent,h.eval('money(307.8)'),'recorded UAH receipts must not be labelled estimated because target FX is missing');
  h.eval(`stateStore.setUI({exchangeRateDate:${JSON.stringify(today)},exchangeRateSource:'NBU'});renderReinvestmentForecast();`);
  assert.match(h.document.querySelector('#reinvestment-status').textContent,/Insufficient history: 82.*90/);
  assert.doesNotMatch(h.document.querySelector('#reinvestment-status').textContent,/Incomplete data/);
  assert.equal(h.document.querySelector('#stat-reinvestment').textContent,'—');
  assert.equal(h.document.querySelectorAll('#reinvestment-scenarios li').length,0);
  assert.deepEqual(h.errors,[]);
});

for (const native of [false, true]) {
  test(`compact ${native ? 'native' : 'web'} budget retains one editable input and Dashboard reveals secondary metrics on demand`, async t => {
    const initial = fixture();
    initial.wallet.months['2026-10'] = { plans: { Health: 500 }, customCategories: [], notes: [] };
    initial.wallet.expenses = [{ id: 'health', category: 'Health', date: '2026-10-01', amount: 100 }];
    const h = await harness(t, { initial, native, compact: true });
    const budgetRegion = h.document.querySelector('#wallet-current .table-wrap');
    assert.equal(budgetRegion.tabIndex, 0);
    assert.equal(budgetRegion.getAttribute('role'), 'region');
    assert.equal(budgetRegion.getAttribute('aria-label'), 'Monthly budget table. Scroll horizontally to see all columns.');
    budgetRegion.focus();
    assert.equal(h.document.activeElement, budgetRegion);
    const input = h.document.querySelector('[data-wallet-plan="Health"]');
    const row = input.closest('tr');
    assert.equal(h.document.querySelectorAll('[data-wallet-plan="Health"]').length, 1);
    assert.equal(row.children[1].dataset.label, 'Plan');
    assert.equal(row.children[3].dataset.label, 'Actual amount');
    assert.match(row.children[3].textContent, /100/);
    assert.equal(row.children[4].dataset.label, 'Balance');
    assert.match(row.children[4].textContent, /400/);
    const persisted = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Budget save did not publish its confirmed state.')); }, 2000);
      const unsubscribe = h.eval('stateStore').subscribe(({ state }) => {
        if (state.data.wallet.months['2026-10'].plans.Health === 600) { clearTimeout(timeout); unsubscribe(); resolve(); }
      });
    });
    input.value = '600'; input.dispatchEvent(new h.window.Event('change')); await persisted; await flush();
    assert.equal(h.eval('stateStore.getData().wallet.months["2026-10"].plans.Health'), 600);
    const more = h.document.querySelector('#dashboard-more-metrics');
    assert.equal(more.open, false);
    assert.equal(h.document.querySelectorAll('#dashboard-key-metrics > .stat-card').length, 4);
    assert.equal(h.document.querySelector('#stat-unrealized-note').closest('details').open, false);
    more.querySelector('summary').click();
    assert.equal(more.open, true); assert.ok(more.querySelector('#stat-roi'));
    h.document.querySelector('#open-investments').click();
    assert.equal(h.document.querySelector('#investments-app .nav-scroll-hint'), null);
    h.document.querySelector('[data-section="macroeconomics"]').click(); await flush();
    assert.equal(h.document.querySelector('#macroeconomics-section').classList.contains('active'), true);
    assert.deepEqual(h.errors, []);
  });
  test(`transactions in ${native ? 'native' : 'web'} resolve missing names by asset/payment links and escape fallback text`, async t => {
    const initial = fixture();
    initial.transactions.push({ ...initial.transactions[0], id: 'named', assetName: 'Historical name' },
      { ...initial.transactions[0], id: 'missing', assetId: 'removed', date: '2025-01-01' },
      { id: 'payment-tx', type: 'COUPON', assetId: 'stale', paymentId: 'coupon', date: '2026-01-02', amount: 10, currency: 'USD' });
    initial.payments.push({ id: 'coupon', assetId: 'stock', type: 'COUPON', date: '2026-01-02', amount: 10, status: 'received', currency: 'USD' });
    const h = await harness(t, { initial, native });
    const cells = () => [...h.document.querySelectorAll('#transactions-table tr')].map(row => row.children[1].textContent.trim());
    assert.ok(cells().includes('Smoke Stock')); assert.ok(cells().includes('Historical name')); assert.ok(cells().includes('Asset unavailable'));
    assert.equal(cells().filter(value => value === 'Smoke Stock').length, 2);
    const next = h.stored(); next.assets[0].name = '<img src=x onerror=alert(1)>';
    h.eval('stateStore').replaceData(next); h.window.renderTransactions();
    assert.equal(h.document.querySelector('#transactions-table img'), null);
    assert.ok(cells().includes(next.assets[0].name));
    assert.deepEqual(h.errors, []);
  });
  test(`asset page stacks grouped holdings in ${native ? 'native offline' : 'desktop'} UI without fetching or mutating data`, async t => {
    const initial = fixture();
    initial.assets[0].purchasePrice = 79996.57 / 5;
    initial.assets[0].currentPrice = 80939.04 / 5;
    initial.transactions[0].amount = 2 * initial.assets[0].purchasePrice;
    initial.assets.push({ ...initial.assets[0], id: 'stock-2', quantity: 3 });
    initial.transactions.push({ ...initial.transactions[0], id: 'buy-2', assetId: 'stock-2', quantity: 3, amount: 3 * initial.assets[0].purchasePrice });
    initial.priceHistory = ['2026-01-10', '2026-02-10'].map((date, index) => ({ id: 'p' + index, assetId: 'stock', date, price: 100 + index * 20, currency: 'USD' }));
    const h = await harness(t, { initial, native, charts: 'real' });
    const before = h.stored(), calls = h.requests.length;
    h.document.querySelector('#dashboard-assets [data-asset-group]').click();
    const section = h.document.querySelector('#asset-detail-section');
    assert.equal(section.classList.contains('active'), true);
    assert.equal(h.document.querySelector('#investments-app').hidden, false);
    assert.equal(h.document.querySelector('#wallet-app').hidden, true);
    assert.equal(section.querySelectorAll('.asset-detail-tabs button').length, 5);
    assert.match(section.textContent, /All purchases of this asset are combined/);
    assert.equal(section.querySelector('[data-asset-holding]'), null);
    assert.equal(section.querySelector('.asset-detail-stats strong').textContent, '5');
    const metrics = section.querySelectorAll('.asset-detail-stats strong');
    assert.match(metrics[1].textContent, /79,996\.57/);
    assert.match(metrics[2].textContent, /80,939\.04/);
    assert.equal(section.querySelector('.asset-detail-stats .stat-card:last-child small').textContent, '1.18%');
    section.querySelector('[data-asset-action="sell"]').click();
    assert.equal(h.document.querySelector('#sell-asset').value, 'stock,stock-2', 'Sell must include both open positions in the card.');
    h.document.querySelector('#close-sell-modal').click();
    for (const tab of ['operations', 'payments', 'price', 'details', 'overview']) section.querySelector(`[data-asset-tab="${tab}"]`).click();
    assert.equal(h.requests.length, calls, 'Opening and navigating the detail page uses the loaded document.');
    assert.deepEqual(h.stored(), before);
    await new Promise(resolve => { h.window.addEventListener('popstate', resolve, { once: true }); section.querySelector('[data-asset-back]').click(); }); await flush();
    assert.equal(h.document.querySelector('#dashboard-section').classList.contains('active'), true);
    h.document.querySelector('[data-section="portfolio"]').click();
    h.document.querySelector('#portfolio-table [data-asset-group]').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(section.classList.contains('active'), true);
    await new Promise(resolve => { h.window.addEventListener('popstate', resolve, { once: true }); section.querySelector('[data-asset-back]').click(); }); await flush();
    assert.equal(h.document.querySelector('#portfolio-section').classList.contains('active'), true);
    assert.deepEqual(h.errors, []);
  });
}

test('asset page escapes text, filters recorded history and uses historical quantities in its chart', async t => {
  const initial = fixture();
  initial.assets[0].name = '<img src=x onerror=alert(1)>';
  initial.transactions.push({ id: 'buy-2', assetId: 'stock', type: 'BUY', quantity: 1, amount: 150, date: '2026-02-01', currency: 'USD' });
  initial.assets[0].quantity = 3;
  initial.priceHistory = [{ id: 'p1', assetId: 'stock', date: '2026-01-10', price: 100 }, { id: 'p2', assetId: 'stock', date: '2026-02-10', price: 120 }];
  const h = await harness(t, { initial, charts: true });
  h.window.ui.asset.open(['stock']);
  const section = h.document.querySelector('#asset-detail-section');
  assert.equal(section.querySelector('[data-asset-heading]').textContent, initial.assets[0].name);
  assert.equal(section.querySelector('img'), null);
  section.querySelector('[data-asset-tab="price"]').click();
  let mode = section.querySelector('[data-asset-chart-mode]'); mode.value = 'value'; mode.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  const config = h.chartCalls.filter(call => call.canvas.id === 'asset-detail-chart').at(-1).config;
  assert.deepEqual(Array.from(config.data.datasets[0].data), [200, 360]);
  const from = section.querySelector('[data-asset-chart-from]'); from.value = '2027-01-01'; from.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.match(section.querySelector('[data-asset-chart-message]').textContent, /At least two/);
  section.querySelector('[data-asset-tab="operations"]').click();
  const filter = section.querySelector('[data-asset-operation-filter]'); filter.value = 'sell'; filter.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  assert.match(section.textContent, /No matching operations/);
  h.window.ui.asset.open(['missing']); assert.match(section.textContent, /Asset not found/);
  assert.deepEqual(h.errors, []);
});

test('asset page distinguishes initial loading, read failure, retry and missing data, and leaves cleanly for Wallet', async t => {
  const h = await harness(t);
  const store = h.eval('stateStore');
  store.setUI({ portfolioLoaded: false, portfolioLoadError: null });
  h.window.ui.asset.open(['stock']);
  const section = h.document.querySelector('#asset-detail-section');
  assert.match(section.textContent, /Loading asset details/);
  store.setUI({ portfolioLoadState: 'error', portfolioLoadError: { message: 'Read failed.' } });
  assert.match(section.textContent, /Could not load asset details/);
  section.querySelector('[data-asset-retry]').click(); await flush();
  assert.equal(store.getState().portfolioLoaded, true);
  assert.match(section.textContent, /Smoke Stock/);
  h.document.querySelector('#open-wallet').click();
  assert.equal(store.getState().assetPage.active, false);
  assert.equal(h.document.querySelector('#wallet-app').hidden, false);
  assert.equal(h.window.location.hash, '');
  assert.deepEqual(h.errors, []);
});

for (const native of [false, true]) {
  test(`asset payment action publishes only after persistence in ${native ? 'native' : 'desktop'} UI`, async t => {
    const initial = fixture();
    initial.payments = [{ id: 'div', assetId: 'stock', assetName: 'Smoke Stock', type: 'DIVIDEND', amount: 10, currency: 'USD', date: '2026-01-10', status: 'planned' }];
    initial.assets.push({ ...initial.assets[0], id: 'stock-2' });
    initial.transactions.push({ ...initial.transactions[0], id: 'buy-2', assetId: 'stock-2' });
    initial.payments.push({ ...initial.payments[0], id: 'div-2', assetId: 'stock-2' });
    const h = await harness(t, { initial, native });
    h.window.ui.asset.open(['stock']);
    const section = h.document.querySelector('#asset-detail-section');
    section.querySelector('[data-asset-tab="payments"]').click();
    section.querySelector('[data-asset-receive]').click(); await flush();
    assert.equal(h.eval('stateStore.getData().payments[0].status'), 'received');
    assert.equal(section.querySelector('[data-asset-receive]'), null);
    assert.match(section.textContent, /Received payments/);
    assert.equal(h.eval('stateStore.getData().transactions.filter(tx => tx.paymentId === "div").length'), 1);
    assert.equal(h.eval('stateStore.getData().payments[1].status'), 'received');
    assert.equal(h.eval('stateStore.getData().transactions.filter(tx => tx.paymentId === "div-2").length'), 1);
    assert.deepEqual(h.errors, []);
  });
}

test('failed payment persistence retains the detail page, unchanged data and a usable retry button', async t => {
  const initial = fixture();
  initial.payments = [{ id: 'div', assetId: 'stock', type: 'DIVIDEND', amount: 10, currency: 'USD', date: '2026-01-10', status: 'planned' }];
  const h = await harness(t, { initial, failPayments: true });
  h.window.ui.asset.open(['stock']);
  const section = h.document.querySelector('#asset-detail-section'); section.querySelector('[data-asset-tab="payments"]').click();
  const before = h.stored(); section.querySelector('[data-asset-receive]').click(); await flush();
  assert.equal(section.classList.contains('active'), true);
  assert.equal(section.querySelector('[data-asset-receive]').disabled, false);
  assert.equal(h.eval('stateStore.getData().payments[0].status'), 'planned');
  assert.deepEqual(h.stored(), before);
  assert.match(h.document.querySelector('#notice-modal').textContent, /payment-test-id/);
  assert.ok(h.errors.every(error => error.startsWith('MARK PAYMENT RECEIVED ERROR:')));
});

test('dashboard separates unrealized and realized results without counting pending payments or returned principal', async t => {
  const initial = fixture();
  initial.sales = [{ id: 'sale', assetId: 'stock', profit: 5, costBasis: 0, quantity: 0, sellPrice: 0, currency: 'USD', sellDate: '2026-01-02' }];
  initial.payments = [{ id: 'div', assetId: 'stock', type: 'DIVIDEND', amount: 10, currency: 'USD', date: '2026-01-03', status: 'received' },
    { id: 'pending', assetId: 'stock', type: 'DIVIDEND', amount: 9999, currency: 'USD', date: '2027-01-03', status: 'planned' }];
  initial.assets.push({ id: 'redeemed', name: 'Redeemed deposit', type: 'deposit', quantity: 1000, purchasePrice: 1, currentPrice: 1, purchaseDate: '2026-01-01', currency: 'USD', closedAt: '2026-02-01T12:00:00Z' });
  initial.transactions.push({ id: 'deposit-buy', assetId: 'redeemed', type: 'BUY', quantity: 1000, amount: 1000, date: '2026-01-01', currency: 'USD' });
  initial.payments.push({ id: 'maturity', assetId: 'redeemed', type: 'MATURITY', amount: 1050, costBasis: 1000, currency: 'USD', date: '2026-02-01', status: 'received' });
  const h = await harness(t, { initial });
  assert.match(h.document.querySelector('#stat-unrealized').dataset.valueUsd, /40/);
  assert.match(h.document.querySelector('#stat-realized').dataset.valueUsd, /65/);
  assert.equal(h.document.querySelector('#dashboard-result-rates'), null);
  const next = h.stored(); next.assets[0].currentPrice = null;
  h.eval('stateStore').replaceData(next); h.window.renderDashboard();
  assert.equal(h.document.querySelector('#stat-unrealized').textContent, 'No quote available');
  h.document.querySelector('#stat-unrealized').closest('.stat-card').dispatchEvent(new h.window.Event('mouseenter'));
  assert.equal(h.document.querySelector('#stat-unrealized').textContent, 'No quote available');
  assert.deepEqual(h.errors, []);
});

for (const native of [false, true]) {
  test(`Return stays a static portfolio result regardless of pointer or benchmark state in ${native ? 'native' : 'desktop'} UI`, async t => {
    const h = await harness(t, { native });
    const value = h.document.querySelector('#stat-roi'), card = value.closest('.stat-card');
    const portfolioReturn = value.textContent;
    assert.match(portfolioReturn, /^-?\d+\.\d{2}%$/);
    assert.equal(h.document.querySelector('#stat-roi-label').textContent, 'Return');
    card.dispatchEvent(new h.window.Event('mouseenter'));
    assert.equal(value.textContent, portfolioReturn);
    h.eval("stateStore.setUI({ sp500Benchmark: 20, sp500BenchmarkStatus: 'ready' }); renderDashboard();");
    assert.equal(value.textContent, portfolioReturn, 'Benchmark data must not replace portfolio Return.');
    card.dispatchEvent(new h.window.Event('mouseleave'));
    assert.equal(value.textContent, portfolioReturn);
    assert.equal(h.document.querySelector('#stat-roi-label').textContent, 'Return');
    card.dispatchEvent(new h.window.Event('focus')); assert.equal(value.textContent, portfolioReturn);
    card.dispatchEvent(new h.window.Event('blur')); assert.equal(value.textContent, portfolioReturn);
    assert.deepEqual(h.errors, []);
  });
  test(`real HTML DOMContentLoaded starts ${native ? 'native offline' : 'desktop'} UI with local scripts and reviewed globals`, async t => {
    const h = await harness(t, { native, bootFromEvent: true, charts: 'real', blockMarkets: true });
    assert.equal(h.window.init, h.window.ui.application.init);
    assert.equal(h.window.loadData, h.window.ui.application.loadData);
    assert.ok(h.document.querySelector('#portfolio-table').textContent.includes('Smoke Stock'));
    h.document.querySelector('#open-wallet').click();
    assert.equal(h.document.querySelector('#wallet-app').hidden, false);
    assert.ok(h.document.querySelector('#wallet-current').classList.contains('active'));
    assert.deepEqual(h.errors, []);
  });
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
  assert.match(fs.readFileSync(path.join(frontend, 'js/main.js'), 'utf8'), /import Chart from ['"]\.\.\/vendor\/chart\.umd\.js['"]/);
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
  h.eval('stateStore.updateData(data => { data.assets[0].currentPrice = 200; })'); h.window.renderRebalanceCalculator();
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
  assert.equal(h.document.querySelector('#wallet-current .table-wrap').getAttribute('aria-label'), 'Таблиця місячного бюджету. Прокручуйте горизонтально, щоб побачити всі колонки.');
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
  const calendarDays = h.document.querySelectorAll('#calendar-grid .calendar-day').length;
  assert.ok(calendarDays >= 28 && calendarDays <= 42 && calendarDays % 7 === 0);
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

for (const native of [false, true]) {
  test(`module expense form retains a failed draft and persists exactly one retry in ${native ? 'offline native' : 'web'}`, async t => {
    const h = await harness(t, { native });
    h.eval(`(() => {
      const save = api.saveWallet; let fail = true;
      api.saveWallet = (...args) => {
        if (fail) { fail = false; return Promise.reject(new window.FinoErrors.StorageError()); }
        return save(...args);
      };
    })()`);
    const before = JSON.stringify(h.eval('stateStore.selectData()'));
    h.window.ui.forms.wallet.expense();
    const form = h.document.querySelector('#expense-form');
    form.elements.date.value = '2026-10-26'; form.elements.category.value = 'Health';
    form.elements.amount.value = '20.50'; form.elements.note.value = 'Keep this expense';
    const submit = () => form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
    submit(); await flush();
    assert.equal(h.document.querySelector('#expense-modal').classList.contains('open'), true);
    assert.equal(form.elements.amount.value, '20.50'); assert.equal(form.elements.note.value, 'Keep this expense');
    assert.equal(JSON.stringify(h.eval('stateStore.selectData()')), before);
    h.document.querySelector('#notice-ok').click(); await flush();
    assert.equal(form.querySelector('[type="submit"]').disabled, false); submit();
    for (let attempt = 0; attempt < 100; attempt++) {
      await flush(); if (h.eval('stateStore.selectWallet().expenses.length') === 1) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const saved = native ? await h.window.mobileApi.getData({ sync: false }) : h.stored();
    assert.equal(saved.wallet.expenses.length, 1); assert.equal(saved.wallet.expenses[0].amount, 20.5);
    assert.equal(saved.wallet.expenses[0].note, 'Keep this expense');
    const restarted = await harness(t, { native, initial: saved, nativeStorage: h.nativeStorage });
    assert.equal(restarted.eval('stateStore.selectWallet().expenses.length'), 1);
    assert.equal(restarted.eval('stateStore.selectWallet().expenses[0].amount'), 20.5);
    assert.deepEqual(restarted.errors, []);
    assert.ok(h.errors.every(error => !error.includes('Uncaught') && !error.includes('store command')));
  });

  test(`module UI persists fractional purchases and sales across restart in ${native ? 'offline native' : 'web'}`, async t => {
    const h = await harness(t, { native });
    const settle = async predicate => {
      for (let attempt = 0; attempt < 100; attempt++) {
        await flush(); if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail('The financial command did not publish its saved result.');
    };
    h.window.ui.forms.buy.open('stock');
    const buy = h.document.querySelector('#buy-more-form');
    buy.elements.quantity.value = '1.5'; buy.elements.purchasePrice.value = '100'; buy.elements.purchaseDate.value = '2026-02-01';
    buy.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle(() => h.eval("getAvailableQuantity('stock')") === 3.5);
    assert.equal(h.eval('stateStore.selectTransactions().filter(item => item.type === "BUY").reduce((sum, item) => sum + item.amount, 0)'), 350);
    h.window.openSellAssetModal('stock');
    h.document.querySelector('#sell-quantity').value = '1';
    h.document.querySelector('#sell-price').value = '180';
    h.document.querySelector('#sell-date').value = '2026-03-01';
    h.document.querySelector('#sell-form').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle(() => h.eval('stateStore.selectSales().length') === 1);
    const saved = native ? await h.window.mobileApi.getData({ sync: false }) : h.stored();
    assert.equal(saved.sales[0].quantity, 1);
    assert.equal(saved.sales[0].costBasis, 100);
    assert.equal(saved.sales[0].profit, 80);
    assert.equal(h.eval("getAvailableQuantity('stock')"), 2.5);
    const restarted = await harness(t, { native, initial: saved, nativeStorage: h.nativeStorage });
    assert.equal(restarted.eval("getAvailableQuantity('stock')"), 2.5);
    assert.equal(restarted.eval('stateStore.selectSales()[0].profit'), 80);
    const before = JSON.stringify(restarted.eval('stateStore.selectData()'));
    restarted.document.querySelector('#open-investments').click();
    for (const section of ['portfolio', 'transactions', 'calendar', 'analytics', 'rebalance', 'dashboard']) {
      restarted.document.querySelector(`[data-section="${section}"]`).click();
      assert.equal(restarted.document.querySelector(`#${section}-section`).classList.contains('active'), true);
    }
    assert.equal(JSON.stringify(restarted.eval('stateStore.selectData()')), before);
    assert.deepEqual(h.errors, []); assert.deepEqual(restarted.errors, []);
  });
}

test('web and native buy forms reuse operationId after a committed purchase loses its response', async t => {
  for (const native of [false, true]) await t.test(native ? 'native' : 'web', async t => {
    const h = await harness(t, { native });
    h.eval(`(() => {
      const purchase = api.buyMoreAsset;
      window.lostBuyCommands = [];
      let drop = true;
      api.buyMoreAsset = async (id, body) => {
        window.lostBuyCommands.push(body.operationId);
        const result = await purchase(id, body);
        if (drop) { drop = false; throw new window.FinoErrors.RemoteUnavailableError({ message: 'The response did not arrive. Retry the same command.' }); }
        return result;
      };
    })()`);
    h.window.ui.forms.buy.open('stock');
    const form = h.document.querySelector('#buy-more-form');
    form.elements.quantity.value = '1'; form.elements.purchasePrice.value = '150'; form.elements.purchaseDate.value = '2026-02-01';
    const submit = () => form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
    submit(); await flush();
    assert.equal(h.document.querySelector('#buy-more-modal').classList.contains('open'), true);
    assert.equal(form.elements.quantity.value, '1');
    assert.equal(h.eval('stateStore.getData().assets[0].quantity'), 2, 'Unacknowledged state must not pretend to be published.');
    h.document.querySelector('#notice-ok').click();
    submit(); await flush();
    assert.equal(h.window.lostBuyCommands.length, 2); assert.equal(h.window.lostBuyCommands[0], h.window.lostBuyCommands[1]);
    assert.equal(h.eval('stateStore.getData().assets[0].quantity'), 3);
    assert.equal(h.eval('stateStore.getData().transactions.filter(tx => tx.type === "BUY").length'), 2);
    assert.equal(h.eval('stateStore.getData().operations.length'), 1);
    assert.equal(h.document.querySelector('#buy-more-modal').classList.contains('open'), false);
    assert.ok(h.errors.every(error => !error.includes('Uncaught') && !error.includes('store command')));
  });
});

test('real web/native HTML recovers the original purchase after client restart and never substitutes edited form data', async t => {
  for (const native of [false, true]) await t.test(native ? 'native restart' : 'browser restart', async t => {
    const h = await harness(t, { native });
    if (native) h.eval(`(() => {
      const original = window.mobileApi.buyMoreAsset; let lose = true;
      window.mobileApi.buyMoreAsset = async (...args) => {
        const result = await original(...args);
        if (lose) { lose = false; throw new window.FinoErrors.RemoteUnavailableError(); } return result;
      };
    })()`);
    else h.eval(`(() => {
      const original = window.fetch; let lose = true;
      window.fetch = async (url, options) => {
        const response = await original(url, options);
        if (lose && url === '/api/assets/stock/buy') { lose = false; await response.text(); throw new TypeError('Acknowledgement lost'); }
        return response;
      };
    })()`);
    h.window.ui.forms.buy.open('stock');
    const form = h.document.querySelector('#buy-more-form');
    form.elements.quantity.value = '1'; form.elements.purchasePrice.value = '150'; form.elements.purchaseDate.value = '2026-02-01';
    form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
    const record = (await h.eval('api.outbox.list()')).entries[0]; assert.equal(record.state, 'outcome-unknown');
    assert.equal(record.body.quantity, 1);
    form.elements.quantity.value = '2'; h.document.querySelector('#notice-ok').click();
    form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
    assert.match(h.document.querySelector('#notice-modal').textContent, /unfinished command/);
    assert.equal(form.elements.quantity.value, '2');
    const committed = await h.eval('api.getData({sync:false})');
    const restarted = await harness(t, { native, initial: committed, nativeStorage: h.nativeStorage, browserStorage: h.browserStorage(), bootFromEvent: true });
    assert.equal(restarted.document.querySelector('#command-recovery').hidden, false);
    assert.equal(restarted.document.querySelector('#buy-more-modal').classList.contains('open'), false);
    const recovered = (await restarted.eval('api.outbox.list()')).entries[0];
    assert.equal(recovered.operationId, record.operationId); assert.equal(recovered.body.quantity, 1);
    restarted.document.querySelector('#command-recovery button').click(); await flush();
    const after = await restarted.eval('api.getData({sync:false})');
    assert.equal(after.assets[0].quantity, 3);
    assert.equal(after.transactions.filter(tx => tx.operationId === record.operationId).length, 1);
    assert.equal((await restarted.eval('api.outbox.list()')).entries.length, 0);
    assert.equal(restarted.document.querySelector('#command-recovery').hidden, true);
    assert.deepEqual(restarted.errors, []);
  });
});

for (const native of [false, true]) {
  test(`general calendar selection, details and payment receipt work in ${native ? 'offline native' : 'web'}`, async t => {
    const initial = fixture();
    initial.payments = [
      { id: 'dividend', assetId: 'stock', type: 'DIVIDEND', status: 'planned', date: '2026-10-26', amount: 25, currency: 'USD' },
      { id: 'coupon', assetId: 'stock', type: 'COUPON', status: 'received', date: '2026-10-26', amount: 10, currency: 'USD' },
    ];
    initial.calendarNotes = [{ id: 'note', assetId: 'stock', assetName: 'План <img src=x>', date: '2026-10-26', amount: 50, currency: 'USD', text: 'Не перекладати назву' }];
    const h = await harness(t, { initial, native, locale: 'uk' });
    h.eval("stateStore.setUI({ calendarDate: new Date(2026, 9, 1), calendarSelectedDate: '2026-10-26' }); renderCalendar();");
    await flush();
    const day = () => h.document.querySelector('[data-calendar-date="2026-10-26"]');
    assert.equal(h.document.querySelectorAll('#calendar-grid .calendar-day').length, 35);
    assert.equal(day().getAttribute('aria-pressed'), 'true');
    assert.equal(day().querySelectorAll('.calendar-event-dot').length, 3);
    assert.equal(day().querySelectorAll('.calendar-event-dot.received').length, 1);
    assert.equal(h.document.querySelectorAll('#calendar-day-events .calendar-event').length, 3);
    assert.match(h.document.querySelector('#calendar-day-events').textContent, /План <img src=x>/);
    assert.equal(h.document.querySelector('#calendar-day-events img'), null);
    const financialBefore = JSON.stringify(h.eval('stateStore.selectData()'));
    assert.equal(h.document.querySelector('.calendar-filters'), null);
    h.document.querySelector('[data-calendar-date="2026-10-27"]').click(); await flush();
    assert.match(h.document.querySelector('#calendar-day-events').textContent, /На цей день подій немає/);
    h.document.querySelector('#add-note-btn').click();
    assert.equal(h.document.querySelector('#note-date').value, '2026-10-27');
    h.document.querySelector('#cancel-note').click();
    h.document.querySelector('[data-calendar-date="2026-10-26"]').click();
    h.document.querySelector('#calendar-day-events .calendar-event.note').click(); await flush();
    assert.equal(h.document.querySelector('#event-modal-title').textContent, 'План <img src=x>');
    assert.equal(h.document.querySelector('#event-modal-content img'), null);
    h.document.querySelector('#event-modal-close-btn').click();
    h.document.querySelector('#calendar-help-btn').click(); await flush();
    assert.equal(h.document.querySelector('#event-modal-title').textContent, 'Позначки календаря');
    assert.equal(h.document.querySelectorAll('#event-modal-content .legend-dot').length, 4);
    h.document.querySelector('#event-modal-close-btn').click();
    assert.equal(JSON.stringify(h.eval('stateStore.selectData()')), financialBefore);
    assert.equal(h.document.querySelectorAll('#calendar-day-events .calendar-event').length, 3);
    h.document.querySelector('#calendar-day-events .calendar-event.dividend').click();
    h.document.querySelector('#mark-payment-received').click();
    for (let attempt = 0; attempt < 100; attempt++) {
      await flush();
      if (h.eval("stateStore.selectPayments().find(payment => payment.id === 'dividend').status") === 'received') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(h.eval("stateStore.selectPayments().find(payment => payment.id === 'dividend').status"), 'received');
    assert.equal(day().querySelectorAll('.calendar-event-dot.received').length, 2);
    assert.deepEqual(h.errors, []);
  });
}

test('calendar navigation clamps month ends, supports keyboard days and resets to today', async t => {
  const h = await harness(t);
  h.eval("stateStore.setUI({ calendarDate: new Date(2026, 0, 31), calendarSelectedDate: '2026-01-31' }); renderCalendar();");
  h.document.querySelector('#next-month').click();
  assert.equal(h.document.querySelector('#calendar-month-picker').value, '2026-02');
  assert.equal(h.eval("stateStore.selectUI('calendarSelectedDate')"), '2026-02-28');
  h.document.querySelector('#previous-month').click();
  assert.equal(h.document.querySelector('#calendar-month-picker').value, '2026-01');
  const picker = h.document.querySelector('#calendar-month-picker');
  picker.value = '2024-02'; picker.dispatchEvent(new h.window.Event('change'));
  assert.equal(h.document.querySelectorAll('#calendar-grid .calendar-day').length, 35);
  h.document.querySelector('[data-calendar-date="2024-02-29"]').click();
  h.document.activeElement.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(h.eval("stateStore.selectUI('calendarSelectedDate')"), '2024-03-01');
  assert.equal(h.document.activeElement.dataset.calendarDate, '2024-03-01');
  assert.equal(h.document.querySelector('#calendar-month-picker').value, '2024-03');
  h.document.querySelector('#today-btn').click();
  assert.equal(h.document.querySelector('.calendar-day[aria-current="date"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(h.errors, []);
});

async function settleMobileNavigation(h, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await flush(); if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Mobile navigation did not settle.');
}

for (const native of [false, true]) {
  test(`mobile navigation reuses real routes, remembers each mode and preserves finances in ${native ? 'offline native' : 'web'}`, async t => {
    const h = await harness(t, { native, compact: true, locale: 'uk', charts: true });
    // Navigation uses deterministic chart doubles; jsdom has no canvas context.
    h.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
    const before = JSON.stringify(h.eval('stateStore.selectData()'));
    const bar = h.document.querySelector('#mobile-bottom-nav');
    const routes = () => Array.from(bar.querySelectorAll('[data-mobile-route]'), button => button.dataset.mobileRoute);
    const click = async id => { bar.querySelector(`[data-mobile-route="${id}"]`).click(); await flush(); };
    assert.equal(bar.dataset.mode, 'wallet');
    assert.deepEqual(routes(), ['current', 'expenses', 'charts', 'loans', 'more']);
    for (const id of ['current', 'expenses', 'charts', 'loans']) {
      await click(id);
      assert.equal(h.document.querySelector(`#wallet-${id}`).classList.contains('active'), true);
      assert.equal(bar.querySelector('[aria-current="page"]').dataset.mobileRoute, id);
    }
    await click('expenses'); assert.equal(h.document.querySelector('#wallet-expenses').classList.contains('active'), true);
    h.document.querySelector('#open-investments').click(); await flush();
    assert.equal(bar.dataset.mode, 'investment');
    assert.deepEqual(routes(), ['dashboard', 'analytics', 'market', 'macroeconomics', 'more']);
    for (const id of ['dashboard', 'analytics', 'market', 'macroeconomics']) {
      await click(id);
      assert.equal(h.document.querySelector(`#${id}-section`).classList.contains('active'), true);
      assert.equal(bar.querySelector('[aria-current="page"]').dataset.mobileRoute, id);
    }
    await click('analytics');
    h.document.querySelector('#open-wallet').click(); await flush();
    assert.equal(h.document.querySelector('#wallet-expenses').classList.contains('active'), true);
    h.document.querySelector('#open-investments').click(); await flush();
    assert.equal(h.document.querySelector('#analytics-section').classList.contains('active'), true);
    assert.equal(bar.querySelector('[aria-current="page"]').dataset.mobileRoute, 'analytics');
    await click('more');
    const backdrop = h.document.querySelector('#mobile-more-backdrop');
    assert.equal(backdrop.hidden, false);
    assert.deepEqual(Array.from(h.document.querySelectorAll('#mobile-more-items button'), button => button.dataset.mobileRoute), ['calendar', 'portfolio', 'transactions', 'rebalance']);
    assert.equal(Boolean(h.document.querySelector('#investments-app').inert), false);
    assert.equal(Boolean(bar.inert), false);
    assert.equal(h.document.querySelector('#mobile-more-sheet').getAttribute('role'), 'menu');
    assert.equal(bar.querySelector('[data-mobile-route="more"]').getAttribute('aria-expanded'), 'true');
    const last = h.document.querySelector('#mobile-more-items button:last-child'); last.focus();
    last.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(h.document.activeElement.dataset.mobileRoute, 'calendar');
    h.window.history.back();
    await settleMobileNavigation(h, () => backdrop.hidden && !h.window.history.state?.finoMobileMore);
    assert.equal(Boolean(h.document.querySelector('#investments-app').inert), false);
    assert.equal(h.document.activeElement.dataset.mobileRoute, 'more');
    await click('more');
    h.document.querySelector('#mobile-more-items [data-mobile-route="portfolio"]').click();
    await settleMobileNavigation(h, () => h.document.querySelector('#portfolio-section').classList.contains('active'));
    assert.equal(backdrop.hidden, true);
    assert.equal(bar.querySelector('[aria-current="page"]').dataset.mobileRoute, 'more');
    await click('more');
    backdrop.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settleMobileNavigation(h, () => backdrop.hidden && !h.window.history.state?.finoMobileMore);
    await click('more'); backdrop.click();
    await settleMobileNavigation(h, () => backdrop.hidden && !h.window.history.state?.finoMobileMore);
    await click('more'); await click('more');
    await settleMobileNavigation(h, () => backdrop.hidden && !h.window.history.state?.finoMobileMore);
    for (const id of ['transactions', 'rebalance']) {
      await click('more');
      h.document.querySelector(`#mobile-more-items [data-mobile-route="${id}"]`).click();
      await settleMobileNavigation(h, () => h.document.querySelector(`#${id}-section`).classList.contains('active'));
      assert.equal(bar.querySelector('[aria-current="page"]').dataset.mobileRoute, 'more');
    }
    await click('more');
    h.document.querySelector('#mobile-more-items [data-mobile-route="calendar"]').click();
    await settleMobileNavigation(h, () => h.document.querySelector('#calendar-section').classList.contains('active'));
    assert.equal(backdrop.hidden, true);
    assert.equal(bar.querySelector('[aria-current="page"]').dataset.mobileRoute, 'more');
    h.document.querySelector('#open-wallet').click(); await flush();
    await click('more');
    assert.deepEqual(Array.from(h.document.querySelectorAll('#mobile-more-items button'), button => button.dataset.mobileRoute), ['archive']);
    h.document.querySelector('#mobile-more-items button').click();
    await settleMobileNavigation(h, () => h.document.querySelector('#wallet-archive').classList.contains('active'));
    assert.equal(JSON.stringify(h.eval('stateStore.selectData()')), before);
    assert.deepEqual(h.errors, []);
  });
}

test('mobile More preserves asset-detail history and choosing a section does not reopen the asset', async t => {
  const h = await harness(t, { compact: true });
  h.document.querySelector('#open-investments').click(); await flush();
  h.window.ui.asset.open(['stock']); await flush();
  assert.match(h.window.location.hash, /^#asset\//);
  h.document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();
  h.window.history.back();
  await settleMobileNavigation(h, () => h.document.querySelector('#mobile-more-backdrop').hidden);
  assert.equal(h.eval('stateStore.selectUI("assetPage").active'), true);
  h.document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();
  h.document.querySelector('#mobile-more-items [data-mobile-route="calendar"]').click();
  await settleMobileNavigation(h, () => h.document.querySelector('#calendar-section').classList.contains('active'));
  assert.equal(h.eval('stateStore.selectUI("assetPage").active'), false);
  assert.equal(h.window.location.hash, '');
  assert.deepEqual(h.errors, []);
});

test('desktop mode switching retains the existing Dashboard and Current defaults', async t => {
  const h = await harness(t);
  h.document.querySelector('[data-wallet-tab="expenses"]').click();
  h.document.querySelector('#open-investments').click();
  h.document.querySelector('[data-section="analytics"]').click();
  h.document.querySelector('#open-wallet').click();
  assert.equal(h.document.querySelector('#wallet-current').classList.contains('active'), true);
  h.document.querySelector('#open-investments').click();
  assert.equal(h.document.querySelector('#dashboard-section').classList.contains('active'), true);
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

async function waitForLoanState(h, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await flush();
    if (predicate(h.eval('stateStore.selectWallet().loans'))) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Loan save did not reach the expected state.');
}

for (const native of [false, true]) {
  test(`paid loans leave the main list without losing repayment history in ${native ? 'native' : 'web'}`, async t => {
    const initial = fixture();
    initial.wallet.loans = [{ id: 'loan', name: 'Loan', amount: 100, balance: 100, method: 'flexible', dueDate: '2099-12-01', status: 'active', repayments: [] }];
    const h = await harness(t, { initial, native, locale: 'uk' });
    const input = () => h.document.querySelector('[data-loan-payment="loan"]');
    const button = () => h.document.querySelector('[data-repay-loan="loan"]');
    assert.equal(button().disabled, false);
    input().value = '40';
    button().click(); await waitForLoanState(h, loans => loans[0].balance === 60);
    let loan = h.eval('stateStore.selectWallet().loans[0]');
    assert.equal(loan.balance, 60);
    assert.equal(loan.repayments.length, 1);
    assert.equal(loan.repayments[0].amount, 40);
    assert.equal(button().disabled, false);
    input().value = '60';
    button().click(); await waitForLoanState(h, loans => loans[0].status === 'paid');
    loan = h.eval('stateStore.selectWallet().loans[0]');
    assert.equal(loan.balance, 0);
    assert.equal(loan.status, 'paid');
    assert.equal(loan.repayments.length, 2);
    assert.equal(button(), null);
    const paid = h.document.querySelector('[data-archive-loan="loan"]');
    assert.equal(paid.textContent, 'Сплачено');
    assert.equal(paid.disabled, false);
    assert.equal(input().disabled, true);
    paid.click(); paid.click(); await waitForLoanState(h, loans => loans[0].archived === true);
    assert.equal(h.document.querySelector('#loans-list .loan-row'), null);
    assert.equal(h.document.querySelector('#paid-loans-list .loan-row strong').textContent, 'Loan');
    assert.equal(h.document.querySelector('#paid-loans-archive').hidden, false);
    assert.equal(h.document.querySelector('#paid-loans-archive').open, false);
    assert.equal(h.document.querySelector('#paid-loans-archive summary').textContent, 'Погашені позики');
    assert.equal(h.eval('stateStore.selectWallet().loans[0].archived'), true);
    assert.equal(h.eval('stateStore.selectWallet().loans[0].repayments.length'), 2);
    assert.equal(h.document.querySelector('#loan-calendar').querySelector('.loan-payment'), null);
    if (!native) {
      assert.equal(h.stored().wallet.loans[0].balance, 0);
      assert.equal(h.stored().wallet.loans[0].repayments.length, 2);
      assert.equal(h.requests.filter(request => request.route === '/api/wallet' && request.method === 'PUT').length, 3);
    }
    const restarted = await harness(t, { native, initial: h.stored(), nativeStorage: h.nativeStorage, locale: 'uk' });
    assert.equal(restarted.document.querySelector('#loans-list .loan-row'), null);
    assert.equal(restarted.eval('stateStore.selectWallet().loans[0].archived'), true);
    assert.equal(restarted.eval('stateStore.selectWallet().loans[0].repayments.length'), 2);
    const restore = restarted.document.querySelector('[data-restore-loan="loan"]');
    assert.equal(restore.textContent, 'Повернути до списку');
    restore.click(); await waitForLoanState(restarted, loans => loans[0].archived === false);
    assert.ok(restarted.document.querySelector('#loans-list [data-archive-loan="loan"]'));
    assert.equal(restarted.document.querySelector('#paid-loans-archive').hidden, true);
    assert.equal(restarted.eval('stateStore.selectWallet().loans[0].repayments.length'), 2);
    assert.deepEqual(restarted.errors, []);
    assert.deepEqual(h.errors, []);
  });

  test(`existing paid loans can be archived and edited in ${native ? 'native' : 'web'}`, async t => {
    const initial = fixture();
    initial.wallet.loans = [
      { id: 'paid', name: 'Paid loan', amount: 100, balance: 0, method: 'flexible', dueDate: '2099-12-01', status: 'paid', repayments: [{ id: 'repayment', date: '2026-10-01', amount: 100 }] },
      { id: 'active', name: 'Active loan', amount: 200, balance: 200, method: 'once', dueDate: '2099-12-01', status: 'active', repayments: [] },
    ];
    const h = await harness(t, { initial, native, compact: native });
    h.document.querySelector('[data-archive-loan="paid"]').click();
    await waitForLoanState(h, loans => loans[0].archived === true);
    assert.equal(h.document.querySelectorAll('#loans-list .loan-row').length, 1);
    assert.ok(h.document.querySelector('#loans-list [data-repay-loan="active"]'));
    const edit = () => h.document.querySelector('#paid-loans-list [data-edit-loan="paid"]').click();
    const form = h.document.querySelector('#loan-form');
    const submit = async predicate => {
      form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
      await waitForLoanState(h, predicate);
    };
    edit(); form.elements.name.value = 'Renamed paid loan'; await submit(loans => loans[0].name === 'Renamed paid loan');
    assert.equal(h.eval('stateStore.selectWallet().loans[0].archived'), true);
    assert.equal(h.document.querySelectorAll('#loans-list .loan-row').length, 1);
    edit(); form.elements.amount.value = '150'; await submit(loans => loans[0].balance === 50);
    assert.equal(h.eval('stateStore.selectWallet().loans[0].balance'), 50);
    assert.equal(h.eval('stateStore.selectWallet().loans[0].archived'), false);
    assert.ok(h.document.querySelector('#loans-list [data-repay-loan="paid"]'));
    assert.equal(h.eval('stateStore.selectWallet().loans[0].repayments.length'), 1);
    assert.deepEqual(h.errors, []);
  });
}

test('failed paid-loan archiving keeps the row and its history until a successful retry', async t => {
  const initial = fixture();
  initial.wallet.loans = [{ id: 'loan', name: 'Paid loan', amount: 100, balance: 0, status: 'paid', repayments: [{ id: 'repayment', date: '2026-10-01', amount: 100 }] }];
  const h = await harness(t, { initial, failWallet: true });
  const before = JSON.stringify(h.eval('stateStore.selectWallet()'));
  const button = h.document.querySelector('[data-archive-loan="loan"]');
  button.click(); await flush();
  assert.equal(button.disabled, false);
  assert.ok(h.document.querySelector('#loans-list [data-archive-loan="loan"]'));
  assert.equal(h.document.querySelector('#paid-loans-archive').hidden, true);
  assert.equal(JSON.stringify(h.eval('stateStore.selectWallet()')), before);
  assert.deepEqual(h.stored().wallet, initial.wallet);
  assert.equal(h.document.querySelector('#notice-modal').classList.contains('open'), true);
  h.document.querySelector('#notice-ok').click();
  h.failWallet(false);
  button.click(); await flush();
  assert.equal(h.document.querySelector('#loans-list .loan-row'), null);
  assert.equal(h.stored().wallet.loans[0].archived, true);
  assert.equal(h.stored().wallet.loans[0].repayments.length, 1);
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

test('UI smoke: a failed wallet plan save retains its draft and preserves browser and server financial state', async t => {
  const h = await harness(t, { failWallet: true });
  const browserBefore = JSON.stringify(h.eval('stateStore.getData()'));
  const serverBefore = h.stored();
  const plan = h.document.querySelector('[data-wallet-plan="Health"]');
  plan.value = '50';
  plan.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(h.document.querySelector('[data-wallet-plan="Health"]').value, '50');
  h.window.renderWalletCurrent();
  assert.equal(h.document.querySelector('[data-wallet-plan="Health"]').value, '50', 'The failed draft must survive a rerender.');
  assert.equal(h.document.querySelector('[data-wallet-plan="Health"]').disabled, false);
  assert.equal(JSON.stringify(h.eval('stateStore.getData()')), browserBefore);
  assert.deepEqual(h.stored(), serverBefore);
  assert.ok(h.errors.some(error => error.includes('UI action failed:')));
  assert.ok(h.errors.every(error => !error.includes('Storage unavailable')));
  assert.match(h.document.querySelector('#notice-message').textContent, /Storage unavailable\./);
  assert.match(h.document.querySelector('#notice-message').textContent, /Request ID: wallet-request-id/);
  assert.ok(h.errors.every(error => !error.includes('Uncaught')));
});

test('error notices show a localized request ID for web and native failures without changing financial state', async t => {
  for (const native of [false, true]) await t.test(native ? 'native' : 'web', async t => {
    const h = await harness(t, { native, failWallet: true, locale: 'uk' });
    const before = JSON.stringify(h.eval('stateStore.getData()'));
    let failure;
    try {
      if (native) await h.eval('api').createAsset({});
      else await h.eval('api').saveWallet(h.eval('stateStore.getData().wallet'));
    } catch (error) { failure = error; }
    assert.ok(failure.requestId); assert.ok(failure.code); assert.ok(failure.category);
    void h.window.showNotice(failure);
    const notice = h.document.querySelector('#notice-message');
    assert.ok(notice.textContent.includes('ID запиту: ' + failure.requestId));
    assert.equal(notice.children.length, 0);
    assert.equal(JSON.stringify(h.eval('stateStore.getData()')), before);
    h.document.querySelector('#notice-ok').click(); assert.deepEqual(h.errors, []);
  });
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

test('wallet draft retries publish one confirmed change and keep failed notes and loan input', async t => {
  const h = await harness(t, { failWallet: true });
  h.eval('window.walletDataEvents = []; stateStore.subscribe(event => { if (event.type === "data:changed") window.walletDataEvents.push(event.command); });');
  const plan = h.document.querySelector('[data-wallet-plan="Health"]');
  plan.value = '75'; plan.dispatchEvent(new h.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(h.window.walletDataEvents.length, 0);
  h.document.querySelector('#notice-ok').click();
  h.failWallet(false);
  const retry = h.document.querySelector('[data-wallet-plan="Health"]');
  retry.dispatchEvent(new h.window.Event('change', { bubbles: true })); await flush();
  assert.deepEqual(Array.from(h.window.walletDataEvents), ['saveWallet']);
  assert.equal(h.eval('Object.keys(stateStore.getState().walletPlanDrafts).length'), 0);
  assert.equal(h.stored().wallet.months[h.document.querySelector('#wallet-current-month').value].plans.Health, 75);
  h.failWallet(true);
  const note = h.document.querySelector('#wallet-note-text'); note.value = 'Keep this unsaved note';
  h.document.querySelector('#wallet-note-form').dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(note.value, 'Keep this unsaved note'); assert.equal(note.disabled, false);
  h.document.querySelector('#notice-ok').click();
  h.document.querySelector('#add-loan-btn').click();
  const form = h.document.querySelector('#loan-form');
  form.elements.name.value = 'Loan draft'; form.elements.amount.value = '1200'; form.elements.dueDate.value = '2026-12-01';
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(h.document.querySelector('#loan-modal').classList.contains('open'), true);
  assert.equal(form.elements.name.value, 'Loan draft'); assert.equal(form.elements.amount.value, '1200');
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
  assert.equal(h.stored().wallet.loans.length, 0);
  assert.deepEqual(Array.from(h.window.walletDataEvents), ['saveWallet']);
  assert.ok(h.errors.every(error => !error.includes('Uncaught') && !error.includes('store command')));
});

test('UI smoke: unknown legacy payment types are displayed as text in history and calendar details', async t => {
  const initial = fixture();
  const type = '<img src=x onerror=alert(1)>';
  initial.payments.push({ id: 'legacy', assetId: 'stock', assetName: 'Legacy payment', type: 'DIVIDEND', status: 'received', date: '2026-01-02', amount: 1, currency: 'USD' });
  const h = await harness(t, { initial });
  // The state contract rejects unknown remote types; renderers still escape old cached or manually injected values.
  h.eval('(() => { const data = JSON.parse(JSON.stringify(stateStore.getData())); data.payments[0].type = ' + JSON.stringify(type) + '; renderTransactions({ ...stateStore.getState(), data }); })();');
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
  assert.match(h.document.querySelector('#rebalance-save-status').textContent, /Request ID:/);
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

test('sync comparison escapes device metadata, explains the whole-document choice and sends no write until confirmation', async t => {
  const initial = fixture(), remote = fixture();
  initial.sync = { revision: 4, updatedAt: '2026-10-01T12:00:00Z', deviceId: '<img src=x onerror=alert(1)>' };
  remote.sync = { revision: 5, updatedAt: '2026-10-02T12:00:00Z', deviceId: 'Other phone' };
  const preview = await require('../../shared/sync-model').comparison(initial, remote);
  const h = await harness(t, { initial, syncPreview: preview, locale: 'uk' });
  h.document.querySelector('[data-drive-action="upload"]').click(); await flush();
  const modal = h.document.querySelector('#sync-preview-modal');
  assert.equal(modal.classList.contains('open'), true);
  assert.equal(h.document.activeElement.id, 'close-sync-preview', 'Opening the comparison must start at its heading, not scroll to the final buttons.');
  assert.equal(modal.querySelector('img'), null); assert.ok(modal.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.match(modal.textContent,/Порівняти збережені версії/);
  assert.match(h.document.querySelector('#sync-preview-consequence').textContent,/хмарної версії/);
  assert.equal(h.requests.filter(r=>r.route==='/api/sync/google-drive').length,0);
  modal.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await flush();
  assert.equal(modal.classList.contains('open'),false);assert.equal(h.requests.filter(r=>r.route==='/api/sync/google-drive').length,0);
  h.document.querySelector('[data-drive-action="download"]').click();await flush();
  assert.match(h.document.querySelector('#sync-preview-consequence').textContent,/Лише локальні записи/);
  h.document.querySelector('#confirm-sync-preview').click();await flush();
  const writes=h.requests.filter(r=>r.route==='/api/sync/google-drive');assert.equal(writes.length,1);
  assert.equal(writes[0].body.action,'download');assert.equal(writes[0].body.previewToken,preview.token);assert.deepEqual(h.errors,[]);
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
