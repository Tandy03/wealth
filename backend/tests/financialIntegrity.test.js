const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const model = require('../../frontend/js/state-model');
const rules = require('../../frontend/js/portfolio-rules');
const finance = require('../../frontend/js/analytics/portfolio-finance');
const { createService } = require('../domain/portfolioService');
const { createApp } = require('../app');
const { requestJson } = require('../services/market/request');
const { normalizeData } = require('../domain/state');
const { buildWeeklyPerformance } = require('../../frontend/js/portfolio-performance');
function memory() {
  let state = model.createEmptyState(), queue = Promise.resolve();
  const repository = {
    readData: async () => structuredClone(state), saveData: async data => { state = model.normalizeState(data); },
    initializeStorage: async () => {}, drive: { getStatus: () => ({ enabled: false, connected: false }) },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  };
  return { repository, snapshot: () => structuredClone(state) };
}
const stock = overrides => ({ name: 'Stock', type: 'stock', currency: 'USD', quantity: 10, purchasePrice: 100, currentPrice: 200, purchaseDate: '2026-01-01', ...overrides });

test('shared legacy normalization and single-purchase edits preserve unfinished orders', () => {
  for (const status of ['pending', 'planned', 'cancelled']) {
    const data = model.createEmptyState();
    data.assets.push(stock({ id: 'a' }));
    data.transactions.push(
      { id: 'completed', assetId: 'a', type: 'BUY', quantity: 10, amount: 1000, currency: 'USD', date: '2026-01-01' },
      { id: 'unfinished', assetId: 'a', type: 'BUY', status, quantity: 5, amount: 1000, currency: 'USD', date: '2026-02-01' },
    );
    const unfinished = structuredClone(data.transactions[1]);
    const normalized = normalizeData(data);
    assert.equal(normalized.transactions[0].quantity, 10); assert.equal(normalized.transactions[0].amount, 1000);
    assert.equal(normalized.assets[0].remainingQuantity, 10); assert.equal(normalized.assets[0].remainingCostBasis, 1000);
    assert.deepEqual(normalized.transactions[1], unfinished);
    normalized.assets[0].purchasePrice = 120;
    rules.updateSinglePurchase(normalized, normalized.assets[0]);
    assert.equal(normalized.transactions[0].amount, 1200); assert.deepEqual(normalized.transactions[1], unfinished);
  }
});

test('partial sale then purchase preserves remaining cost, averages and the next sale result', async () => {
  const h = memory(), service = createService(h.repository);
  const asset = await service.createAsset(stock());
  const first = await service.sellAsset({ assetId: asset.id, quantity: 5, sellPrice: 120, sellDate: '2026-02-01' });
  const bought = await service.buyMoreAsset(asset.id, { quantity: 5, purchasePrice: 200, purchaseDate: '2026-03-01' });
  assert.equal(bought.asset.quantity, 15); // Total acquired, including sold units.
  assert.equal(bought.asset.remainingQuantity, 10);
  assert.equal(bought.asset.purchasePrice, 150);
  assert.equal(bought.asset.remainingCostBasis, 1500);
  const state = { data: h.snapshot() };
  const analytics = finance.createService({ state, market: { toUAHPurchaseCost: value => value, getExchangeRateOnDate: () => 1 }, values: { normalizeNumber: Number, getDateString: () => '2026-10-12' } });
  assert.equal(analytics.getAssetInvestedUsd(bought.asset), 1500);
  assert.equal(analytics.getUnrealizedPriceGrowth(bought.asset), 500);
  const next = await service.sellAsset({ assetId: asset.id, quantity: 2, sellPrice: 200, sellDate: '2026-04-01' });
  assert.equal(next.sale.costBasis, 300);
  assert.equal(next.sale.profit, 100);
  assert.deepEqual(h.snapshot().sales[0], first.sale);
  assert.equal(h.snapshot().assets[0].remainingCostBasis, 1200);
  const history = h.snapshot();
  history.priceHistory.push({ assetId: asset.id, date: '2026-04-05', price: 200 });
  const point = buildWeeklyPerformance(history, { today: '2026-04-05', exchangeRateOnDate: () => 1 }).points.at(-1);
  assert.equal(point.realized, 200);
  assert.equal(point.unrealized, 400);
});

test('legacy purchase fallback stays stable across a later purchase and repeated normalization', async () => {
  const h = memory();
  const data = model.createEmptyState();
  data.assets.push(stock({ id: 'legacy', note: 'preserve' }));
  data.sales.push({ id: 'old-sale', assetId: 'legacy', quantity: 5, sellDate: '2026-02-01', purchasePrice: 100, costBasis: 500, saleProceeds: 600, profit: 100 });
  await h.repository.saveData(data);
  const service = createService(h.repository);
  const bought = await service.buyMoreAsset('legacy', { quantity: 5, purchasePrice: 200, purchaseDate: '2026-03-01' });
  assert.equal(bought.asset.purchasePrice, 150);
  const once = normalizeData(h.snapshot());
  assert.equal(once.assets[0].remainingCostBasis, 1500);
  assert.deepEqual(normalizeData(once), once);
  assert.equal(once.assets[0].note, 'preserve');
  const before = h.snapshot();
  await assert.rejects(service.updateAsset('legacy', { ...bought.asset, purchasePrice: 1 }), /history/);
  assert.deepEqual(h.snapshot(), before);
  await service.updateAsset('legacy', { ...bought.asset, currentPrice: 250 });
  for (const field of ['purchasePrice', 'costBasis', 'saleProceeds', 'profit']) assert.equal(h.snapshot().sales[0][field], before.sales[0][field]);
});

test('a received dividend from one merged holding leaves only the unpaid portion planned', async () => {
  const h = memory(), service = createService(h.repository);
  const definition = { ...stock(), name: 'REIT', type: 's1_reit', dividendPerUnit: 10, firstDividendDate: '2026-11-10' };
  const a = await service.createAsset(definition), b = await service.createAsset(definition);
  const data = h.snapshot();
  const paid = data.payments.find(p => p.assetId === a.id && p.date === '2026-11-10');
  paid.status = 'received';
  await h.repository.saveData(data);
  await service.mergeAssets([a.id, b.id]);
  const period = h.snapshot().payments.filter(p => p.date === '2026-11-10');
  assert.equal(period.filter(rules.received).reduce((sum, p) => sum + p.amount, 0), 100);
  assert.equal(period.filter(p => !rules.received(p)).reduce((sum, p) => sum + p.amount, 0), 100);
});

test('sales reduce future coupons and redemption, with quantities resolved on the event date', async () => {
  const h = memory(), service = createService(h.repository);
  const asset = await service.createAsset({ ...stock(), name: 'Bond', type: 'ovdp', currency: 'UAH', isin: 'UA1234567890', purchasePrice: 1000, maturityDate: '2027-12-01', coupons: [{ date: '2027-06-01', amountPerUnit: 50 }] });
  await service.sellAsset({ assetId: asset.id, quantity: 5, sellPrice: 1000, sellDate: '2026-02-01' });
  const payments = await service.getAssets().then(() => h.repository.readData());
  assert.equal(payments.payments.find(p => p.type === 'COUPON').amount, 250);
  assert.equal(payments.payments.find(p => p.type === 'MATURITY').amount, 5000);
  assert.equal(rules.quantityOnDate(payments, asset.id, '2026-01-31'), 10);
  assert.equal(rules.quantityOnDate(payments, asset.id, '2026-02-01'), 5);
});

test('dividends use an explicit record date or the documented previous-month-end rule', () => {
  const data = model.createEmptyState();
  const asset = stock({ id: 'stock', dividendRecordRule: 'previous_month_end' });
  data.assets.push(asset);
  data.transactions.push({ assetId: asset.id, type: 'BUY', date: '2026-01-01', quantity: 10, amount: 1000 });
  data.sales.push({ assetId: asset.id, quantity: 5, sellDate: '2026-02-05', costBasis: 500 });
  data.payments.push({ assetId: asset.id, type: 'DIVIDEND', status: 'planned', date: '2026-02-10', amountPerUnit: 10 }, { assetId: asset.id, type: 'DIVIDEND', status: 'planned', date: '2026-03-10', amountPerUnit: 10 }, { assetId: asset.id, type: 'DIVIDEND', status: 'planned', date: '2026-02-10', recordDate: '2026-02-06', amountPerUnit: 10 });
  rules.refreshPayments(data);
  assert.deepEqual(data.payments.map(p => p.amount), [100, 50, 50]);
});

test('merging rebuilds one dividend schedule and preserves received amounts', async () => {
  const h = memory(), service = createService(h.repository);
  const definition = { ...stock(), name: 'REIT', type: 's1_reit', dividendPerUnit: 10, firstDividendDate: '2026-11-10' };
  const a = await service.createAsset(definition), b = await service.createAsset(definition);
  const data = h.snapshot();
  data.payments.push({ id: 'received', assetId: b.id, type: 'DIVIDEND', status: 'received', date: '2026-09-10', amount: 100, currency: 'USD', receipt: 'preserve' });
  await h.repository.saveData(data);
  const merged = await service.mergeAssets([a.id, b.id]);
  const payments = h.snapshot().payments;
  const future = payments.filter(p => p.date === '2026-11-10' && !rules.received(p));
  assert.equal(future.length, 1);
  assert.equal(future[0].amount, 200);
  assert.equal(payments.find(p => p.id === 'received').amount, 100);
  assert.equal(payments.find(p => p.id === 'received').receipt, 'preserve');
  assert.equal(merged.remainingQuantity, 20);
});

test('merge rejects mismatched ticker, ISIN or maturity date without saving', async () => {
  for (const [field, value] of [['ticker', 'OTHER'], ['isin', 'OTHER'], ['maturityDate', '2028-01-01']]) {
    const h = memory(), service = createService(h.repository);
    const a = await service.createAsset(stock({ ticker: 'TEST' }));
    const b = await service.createAsset(stock({ ticker: 'TEST', [field]: value }));
    const before = h.snapshot();
    // ISIN is persisted only for bonds; use an imported record to test identity.
    if (field === 'isin') { before.assets[1].isin = value; await h.repository.saveData(before); }
    if (field === 'maturityDate') { before.assets[1].maturityDate = value; await h.repository.saveData(before); }
    const snapshot = h.snapshot();
    await assert.rejects(service.mergeAssets([a.id, b.id]), /same asset/);
    assert.deepEqual(h.snapshot(), snapshot);
  }
});

test('a stalled sync provider never holds the portfolio mutation queue', async () => {
  const h = memory();
  let release;
  const catalog = new Promise(resolve => { release = resolve; });
  const service = createService(h.repository, { getInzhurCatalogAssets: () => catalog });
  const syncing = service.syncAssets();
  const asset = await Promise.race([service.createAsset(stock()), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Mutation was blocked by provider')), 1000); timer.unref(); })]);
  assert.ok(asset.id);
  release([]);
  await syncing;
  assert.equal(h.snapshot().assets.length, 1);
});

test('external deadlines cover stalled headers and stalled response bodies', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    await assert.rejects(requestJson('https://fixture.invalid/', {}, { fetchImpl, timeoutMs: 10 }), error => error.status === 504 && error.code === 'EXTERNAL_API_TIMEOUT');
  }
});

test('API rejects malformed financial input, HTML types and cross-site access with honest codes', async t => {
  const h = memory(), service = createService(h.repository);
  const asset = await service.createAsset(stock());
  const server = createApp({ repository: h.repository }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const before = h.snapshot();
  for (const body of [stock({ purchaseDate: '2026-02-31' }), stock({ purchasePrice: 'not-a-number' }), stock({ type: 'deposit', maturityDate: 'invalid', annualRate: -100 }), stock({ type: 'deposit', maturityDate: '2025-01-01', annualRate: 20 }), stock({ quantity: 1e308, purchasePrice: 1e308 })]) {
    const response = await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  const edit = await fetch(base + '/api/assets/' + asset.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stock({ type: 'deposit', maturityDate: 'invalid', annualRate: -100 })) });
  assert.equal(edit.status, 400);
  const malicious = await fetch(base + '/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: asset.id, type: '<img src=x onerror=alert(1)>', date: '2026-11-01', amount: 1, currency: 'USD' }) });
  assert.equal(malicious.status, 400);
  const denied = await fetch(base + '/api/data', { headers: { Origin: 'https://attacker.invalid' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('X-Error-Category'), 'access_denied');
  assert.equal((await fetch(base + '/api/data', { headers: { Origin: base } })).status, 403);
  const cookie = (await fetch(base + '/')).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/data', { headers: { Origin: base, Cookie: cookie } })).status, 200);
  const missing = await fetch(base + '/api/missing');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('Content-Type'), /application\/json/);
  const media = await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(media.status, 415);
  assert.deepEqual(h.snapshot(), before);
});
