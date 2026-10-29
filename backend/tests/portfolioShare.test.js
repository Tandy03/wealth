const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const model = require('../../shared/state-model');
const { createStore } = require('../../frontend/js/state-store');
const values = require('../../frontend/js/analytics/values');
const marketModule = require('../../frontend/js/market-data');
const financeModule = require('../../frontend/js/analytics/portfolio-finance');
const cashflowModule = require('../../frontend/js/cashflow');
const feature = require('../../frontend/js/share-card/data');
const card = require('../../frontend/js/share-card/card');
const platformModule = require('../../frontend/js/share-card/platform');
const today = '2026-10-21';
function fixture() {
  const data = model.createEmptyState();
  data.assets.push({ id: 'a', name: 'Private security', type: 'stock', currency: 'UAH', quantity: 10, purchasePrice: 100, currentPrice: 150, purchaseDate: '2026-01-01', lastSyncedAt: today },
    { id: 'savings', name: 'Private savings account', type: 'savings', currency: 'UAH', quantity: 1e6, purchasePrice: 1 });
  data.transactions.push({ id: 'buy', assetId: 'a', type: 'BUY', date: '2026-01-01', quantity: 10, amount: 1000, currency: 'UAH' },
    { id: 'pending', assetId: 'a', type: 'BUY', date: '2026-02-01', quantity: 20, amount: 2000, currency: 'UAH', status: 'pending' },
    { id: 'sale-mirror', type: 'SELL', assetId: 'a', saleId: 'sale', date: '2026-02-01', amount: 400, quantity: 2, currency: 'UAH' },
    { id: 'income-mirror', type: 'DIVIDEND', assetId: 'a', paymentId: 'receipt', date: '2026-04-03', amount: 100, currency: 'UAH' });
  data.sales.push({ id: 'sale', assetId: 'a', quantity: 2, sellDate: '2026-02-01', sellPrice: 200, costBasis: 200, saleProceeds: 400, profit: 200, currency: 'UAH' });
  data.payments.push({ id: 'receipt', assetId: 'a', type: 'DIVIDEND', date: '2026-03-01', receivedDate: '2026-04-03', amount: 100, currency: 'UAH', status: 'received' },
    { id: 'planned', assetId: 'a', type: 'COUPON', date: '2026-06-01', amount: 1e6, currency: 'UAH', status: 'planned' });
  data.priceHistory.push({ assetId: 'a', date: '2026-01-01', price: 100, source: 'initial' }, { assetId: 'a', date: '2026-06-30', price: 130, source: 'Recorded' },
    { assetId: 'a', date: '2026-10-21', price: 150, source: 'Recorded' });
  return data;
}
function setup(data = fixture(), extra = {}) {
  const exchangeRates = { UAH: 1, USD: 45 }, historicalRates = { USD: 40 };
  const store = createStore({ model, guard: 'test', initialState: { data, rebalanceDrafts: [], purchaseExchangeRates: { USD: [{ date: '2026-06-30', rate: 40 }, { date: today, rate: 45 }] }, exchangeRateDate: today, exchangeRateSource: 'NBU', ...extra } });
  const readers = { selectData: store.selectData, selectUI: store.selectUI };
  const market = marketModule.createService({ ...readers, values, exchangeRates, historicalRates });
  const finance = financeModule.createService({ ...readers, values, market });
  const services = { ...market, ...finance, ...cashflowModule.createService({ ...readers, values, market, finance }) };
  const report = options => feature.createReport({ data: store.selectData(), services, readUI: store.selectUI, exchangeRates, historicalRates, today, ...options });
  return { store, services, report };
}
test('Current share metrics match Dashboard services and allocation, including deduplication and incomplete-order rules', () => {
  const h = setup(), before = JSON.stringify(h.store.selectData());
  const result = h.report(), valuation = h.services.valuation(today), profit = h.services.calculateProfit();
  assert.equal(result.metrics.value, valuation.knownValue);
  assert.equal(result.metrics.invested, valuation.costBasis);
  assert.equal(result.metrics.realized, profit.totalProfit);
  assert.equal(result.metrics.profit, profit.totalProfit + valuation.unrealized);
  assert.equal(result.metrics.return, result.metrics.profit / (valuation.costBasis + profit.invested) * 100);
  assert.equal(result.metrics.xirr, h.services.calculatePortfolioXirrDetails(valuation, h.services.cashEvents(today)).value);
  assert.equal(result.metrics.realized, 300, 'Sale proceeds are not profit, receipt mirrors and planned cash are not income');
  assert.equal(result.metrics.value, 1200); assert.equal(result.metrics.count, 1);
  assert.deepEqual(result.allocation, [{ type: 'stock', amount: 1200 }]);
  assert.deepEqual(h.report({ period: 'all' }).metrics, result.metrics);
  assert.equal(JSON.stringify(h.store.selectData()), before);
});
test('historical dates use dated holdings, recorded past quotes and end-date FX without inventing period Return or XIRR', () => {
  const h = setup();
  const result = h.report({ period: 'custom', custom: { from: '2026-02-01', to: '2026-06-30' } });
  assert.equal(result.metrics.value, 1040);
  assert.equal(result.metrics.unrealized, 240);
  assert.equal(result.metrics.invested, 800);
  assert.equal(result.metrics.realized, 300);
  for (const id of ['profit', 'return', 'xirr']) assert.equal(result.metrics[id], null);
  assert.deepEqual(result.allocation, [{ type: 'stock', amount: 1040 }]);
  const beforeReceipt = h.report({ period: 'custom', custom: { from: '2026-03-01', to: '2026-03-31' } });
  assert.equal(beforeReceipt.metrics.realized, 0, 'Actual receipt date, not its planned date');
  assert.equal(beforeReceipt.metrics.value, null, 'Initial purchase snapshots are not current market quotes');
  assert.equal(beforeReceipt.allocation.length, 0);
  assert.equal(beforeReceipt.partial, true);
  h.store.updateData(draft => { draft.assets[0].currentPrice = 10000; });
  assert.deepEqual(h.report({ period: 'custom', custom: { from: '2026-02-01', to: '2026-06-30' } }).metrics, result.metrics);
});
test('Current allocation retains the analytics class order even when an earlier holding has no remaining units', () => {
  const data = fixture();
  data.assets.unshift({ id: 'old-etf', type: 'etf', name: 'Old ETF', quantity: 0, purchasePrice: 100, currency: 'UAH', purchaseDate: '2026-01-01' });
  data.assets.push({ id: 'new-etf', type: 'etf', name: 'New ETF', quantity: 1, purchasePrice: 100, currentPrice: 110, currency: 'UAH', purchaseDate: '2026-01-01' });
  assert.deepEqual(setup(data).report().allocation, [{ type: 'etf', amount: 110 }, { type: 'stock', amount: 1200 }]);
});
test('share date ranges clamp calendar months and leap years and reject impossible, reversed or future custom dates', () => {
  assert.deepEqual(feature.range('1m', '2024-03-31'), { from: '2024-02-29', to: '2024-03-31' });
  assert.equal(feature.range('1y', '2024-02-29').from, '2023-02-28');
  assert.equal(feature.range('3m', today).from, '2026-07-21');
  assert.equal(feature.range('6m', today).from, '2026-04-21');
  assert.equal(feature.range('ytd', today).from, '2026-01-01');
  for (const custom of [{ from: '2026-02-31', to: today }, { from: today, to: '2026-01-01' }, { from: today, to: '2026-10-22' }]) assert.throws(() => feature.range('custom', today, custom));
});
test('maturity principal, pending income and linked transactions do not inflate the shared profit', () => {
  const data = fixture();
  data.assets.push({ id: 'bond', name: 'Private bond', type: 'ovdp', currency: 'UAH', quantity: 2, purchasePrice: 1000, purchaseDate: '2026-01-01', maturityDate: '2026-06-01', closedAt: '2026-06-01' });
  data.transactions.push({ id: 'bond-buy', assetId: 'bond', type: 'BUY', date: '2026-01-01', quantity: 2, amount: 2000, currency: 'UAH' },
    { id: 'maturity-mirror', assetId: 'bond', type: 'MATURITY', date: '2026-06-01', paymentId: 'principal', amount: 2000, currency: 'UAH' });
  data.payments.push({ id: 'principal', assetId: 'bond', type: 'MATURITY', date: '2026-06-01', status: 'received', amount: 2000, costBasis: 2000, currency: 'UAH' });
  const report = setup(data).report();
  assert.equal(report.metrics.realized, 300); assert.equal(report.metrics.profit, 700);
  assert.equal(report.metrics.count, 1);
});
test('historical multicurrency values use available dated FX and never silently borrow future report rates', () => {
  const data = fixture();
  data.assets[0].currency = 'USD';
  for (const record of [...data.transactions, ...data.sales, ...data.payments]) record.currency = 'USD';
  const good = setup(data).report({ period: 'custom', custom: { from: '2026-01-01', to: '2026-06-30' } });
  assert.equal(good.metrics.value, 1040 * 40); assert.equal(good.metrics.realized, 300 * 40);
  const missing = setup(data, { purchaseExchangeRates: {} }).report({ period: 'custom', custom: { from: '2026-01-01', to: '2026-06-30' } });
  assert.equal(missing.metrics.value, null); assert.equal(missing.metrics.realized, null); assert.equal(missing.partial, true);
});
test('empty, negative, missing-quote and extreme values remain explicit and serializable', () => {
  const empty = setup(model.createEmptyState()).report();
  assert.equal(empty.metrics.value, 0); assert.equal(empty.metrics.return, null); assert.equal(empty.metrics.xirr, null);
  const loss = fixture(); loss.assets[0].currentPrice = 1;
  assert.ok(setup(loss).report().metrics.profit < 0);
  loss.assets[0].currentPrice = undefined;
  const missing = setup(loss).report();
  assert.equal(missing.metrics.value, null); assert.equal(missing.metrics.profit, null); assert.equal(missing.partial, true);
});
test('SVG contains only selected public metrics and class labels, with no private names, totals or metadata', () => {
  const report = setup().report(); report.metrics.value = 987654321.45;
  const render = selected => card.render({ report, selected, locale: 'uk', t: text => text, typeLabels: { stock: 'Stocks <unsafe>' } });
  const hidden = render({ return: true, allocation: true, branding: false });
  assert.doesNotMatch(hidden, /987|Private security|Private savings|<script|<foreignObject|<image|fino|undefined|NaN|Infinity/);
  assert.match(hidden, /Stocks &lt;unsafe&gt;/);
  const dom = new JSDOM(hidden, { contentType: 'image/svg+xml' });
  assert.equal(dom.window.document.documentElement.getAttribute('width'), '1080');
  assert.equal(dom.window.document.documentElement.getAttribute('height'), '1080'); dom.window.close();
  for (const locale of ['en', 'uk', 'de', 'es', 'pl', 'it']) {
    report.metrics.value = -1e25;
    assert.doesNotMatch(card.render({ report, selected: { value: true }, locale, t: text => text, typeLabels: {} }), /NaN|Infinity|undefined/);
  }
});
test('platform fallback never treats Android WebView as a browser download and shares files without including text data', async () => {
  let shared, clicked = 0; const revoked = [];
  const document = { body: { append() {} }, createElement: () => ({ click() { clicked++; }, remove() {} }) };
  const window = { Blob, File, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url) }, navigator: { canShare: () => true, share: input => { shared = input; return Promise.resolve(); } } };
  const platform = platformModule.create({ window, document });
  const file = platform.file(new Blob(['PNG'], { type: 'image/png' }), 'fino-portfolio-2026-10-21.png');
  assert.equal(platform.canShare(file), true); await platform.share(file);
  assert.deepEqual(Object.keys(shared), ['files']); assert.equal(shared.files[0].name, file.name);
  platform.download(file, file.name); assert.equal(clicked, 1); platform.release(); assert.deepEqual(revoked, ['blob:test']);
  const native = platformModule.create({ window, nativeApi: {}, document });
  assert.equal(native.supported, false); assert.equal(native.canShare(file), false);
});
test('PNG rasterization waits for the font promise, uses one 1080 canvas and releases temporary resources on completion and cancellation', async () => {
  const calls = [], revoked = []; let finishFonts;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => calls.push(args.slice(1)) }), toBlob: callback => callback(new Blob(['PNG'], { type: 'image/png' })) };
  const fontReady = new Promise(resolve => { finishFonts = resolve; });
  const document = { fonts: { load: font => { assert.equal(font, '16px Arial'); return fontReady; } }, createElement: () => canvas };
  const window = { Blob, URL: { createObjectURL: () => 'blob:svg', revokeObjectURL: url => revoked.push(url) }, Image: class { set src(value) { if (value) queueMicrotask(() => this.onload?.()); } } };
  const pending = platformModule.png('<svg/>', { document, window });
  assert.equal(calls.length, 0); finishFonts();
  assert.equal((await pending).type, 'image/png');
  assert.deepEqual(calls, [[0, 0, 1080, 1080]]); assert.deepEqual(revoked, ['blob:svg']); assert.equal(canvas.width, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(platformModule.png('<svg/>', { document, window, signal: controller.signal }), { name: 'AbortError' });
});
