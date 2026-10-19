const test = require('node:test');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../../shared/state-model');
const { StorageError, RemoteUnavailableError } = require('../../shared/errors');
const { createService: assets } = require('../domain/assetService');
const { createService: purchases } = require('../domain/purchaseService');
const { createService: sales } = require('../domain/saleService');
const { createService: merges } = require('../domain/assetMergeService');
const { createService: sync } = require('../domain/assetSyncService');
const clone = value => structuredClone(value);
const stock = overrides => ({ name: 'Queue stock', type: 'stock', currency: 'USD', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01', ticker: 'TEST', ...overrides });
const buy = overrides => ({ quantity: 1, purchasePrice: 200, purchaseDate: '2026-03-01', ...overrides });
const sell = (id, overrides) => ({ assetId: id, quantity: 5, sellPrice: 120, sellDate: '2026-02-01', ...overrides });
const gate = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function memory(initial = model.createEmptyState()) {
  let data = clone(initial), queue = Promise.resolve(), failure = false;
  const context = new AsyncLocalStorage();
  const counts = { entries: 0, saves: 0 };
  const repository = {
    initializeStorage: async () => {}, drive: { isEnabled: () => false, getStatus: () => ({}) },
    readData: async () => { await new Promise(setImmediate); return clone(data); },
    async saveData(value) {
      assert.equal(context.getStore(), true, 'A domain write escaped the repository queue.');
      if (failure) throw new StorageError();
      await new Promise(setImmediate);
      data = model.normalizeState(value); counts.saves++;
    },
    runMutation(operation) {
      assert.notEqual(context.getStore(), true, 'Nested mutation queue entry would deadlock.');
      counts.entries++;
      const result = queue.then(() => context.run(true, operation));
      queue = result.catch(() => {});
      return result;
    },
  };
  return { repository, counts, snapshot: () => clone(data), insideQueue: () => context.getStore() === true, fail: value => { failure = value; } };
}

test('HTTP asset/purchase/sale/merge commands enter the queue once and preserve response shapes', { timeout: 5000 }, async t => {
  t.mock.method(console, 'info', () => {});
  const h = memory(), server = require('../app').createApp({ repository: h.repository }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(method, endpoint, body, expectedStatus, commits = 1) {
    const before = { ...h.counts };
    const response = await fetch(base + endpoint, { method, signal: AbortSignal.timeout(1000),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.equal(response.status, expectedStatus, method + ' ' + endpoint);
    assert.equal(h.counts.entries - before.entries, method === 'GET' ? 0 : 1);
    assert.equal(h.counts.saves - before.saves, commits);
    return response.json();
  }
  const asset = await request('POST', '/api/assets', stock(), 201);
  const updated = await request('PUT', '/api/assets/' + asset.id, stock({ currentPrice: 140 }), 200);
  assert.equal(updated.id, asset.id); assert.equal(updated.currentPrice, 140);
  const sold = await request('POST', '/api/sales', sell(asset.id), 201);
  assert.deepEqual(Object.keys(sold).sort(), ['remainingQuantity', 'sale', 'transaction']);
  assert.equal(sold.sale.costBasis, 500); assert.equal(sold.sale.profit, 100);
  const bought = await request('POST', '/api/assets/' + asset.id + '/buy', buy({ quantity: 5 }), 201);
  assert.deepEqual(Object.keys(bought).sort(), ['asset', 'transaction']);
  assert.equal(bought.asset.remainingQuantity, 10); assert.equal(bought.asset.remainingCostBasis, 1500); assert.equal(bought.asset.purchasePrice, 150);
  const second = await request('POST', '/api/assets', stock(), 201);
  const merged = await request('POST', '/api/assets/merge', { assetIds: [asset.id, second.id] }, 200);
  assert.equal(merged.id, asset.id); assert.equal(merged.remainingQuantity, 20); assert.equal(merged.remainingCostBasis, 2500);
  assert.equal((await request('GET', '/api/assets', undefined, 200, 0)).length, 1);
  assert.equal((await request('GET', '/api/sales', undefined, 200, 0))[0].id, sold.sale.id);
  const removed = await request('DELETE', '/api/assets/' + asset.id, undefined, 200);
  assert.deepEqual(Object.keys(removed).sort(), ['asset', 'success']); assert.equal(removed.success, true);
  const before = h.snapshot();
  for (const [method, endpoint, body, status] of [
    ['POST', '/api/assets/merge', { assetIds: ['missing', 'also-missing'] }, 404],
    ['POST', '/api/assets', stock({ purchasePrice: 'bad' }), 400],
    ['POST', '/api/sales', sell(asset.id), 404],
    ['POST', '/api/assets/' + asset.id + '/buy', buy(), 404],
  ]) {
    const error = await request(method, endpoint, body, status, 0);
    assert.deepEqual(Object.keys(error).sort(), ['category', 'code', 'error']);
    assert.deepEqual(h.snapshot(), before);
  }
});

test('independent sale and purchase services share one queue, prevent overselling and preserve every concurrent purchase', async () => {
  const h = memory(), a = assets(h.repository), firstSales = sales(h.repository), secondSales = sales(h.repository);
  const asset = await a.createAsset(stock());
  const results = await Promise.allSettled([firstSales.sellAsset(sell(asset.id, { quantity: 8 })), secondSales.sellAsset(sell(asset.id, { quantity: 8 }))]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.category, 'validation');
  const sale = results[0].value.sale;
  assert.equal(sale.costBasis, 800); assert.equal(sale.profit, 160);
  const purchaseServices = [purchases(h.repository), purchases(h.repository)];
  await Promise.all(Array.from({ length: 10 }, (_, i) => purchaseServices[i % 2].buyMoreAsset(asset.id, buy())));
  let snapshot = h.snapshot();
  assert.equal(snapshot.assets[0].quantity, 20); assert.equal(snapshot.assets[0].remainingQuantity, 12);
  assert.equal(snapshot.assets[0].remainingCostBasis, 2200); assert.equal(snapshot.assets[0].purchasePrice, 2200 / 12);
  assert.deepEqual(snapshot.sales[0], sale);
  const other = await a.createAsset(stock());
  const mixed = await Promise.allSettled([merges(h.repository).mergeAssets([asset.id, other.id]), a.deleteAsset(other.id)]);
  assert.deepEqual(mixed.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(mixed[1].reason.status, 404);
  snapshot = h.snapshot();
  assert.equal(snapshot.assets.length, 1); assert.equal(snapshot.assets[0].remainingQuantity, 22);
  assert.equal(snapshot.assets[0].remainingCostBasis, 3200);
  assert.equal(h.counts.entries, 16); assert.equal(h.counts.saves, 14);
});

test('all new service writes roll back on storage failure and the same queue remains usable', async () => {
  const h = memory(), a = assets(h.repository), p = purchases(h.repository), s = sales(h.repository), m = merges(h.repository);
  const first = await a.createAsset(stock()), second = await a.createAsset(stock());
  const before = h.snapshot(), entries = h.counts.entries, saves = h.counts.saves;
  h.fail(true);
  for (const operation of [
    () => a.createAsset(stock()), () => a.updateAsset(first.id, stock({ currentPrice: 130 })),
    () => a.deleteAsset(first.id), () => p.buyMoreAsset(first.id, buy()),
    () => s.sellAsset(sell(first.id)), () => m.mergeAssets([first.id, second.id]),
  ]) {
    await assert.rejects(operation(), { code: 'STORAGE_FAILURE', status: 503, category: 'storage_failure' });
    assert.deepEqual(h.snapshot(), before);
  }
  assert.equal(h.counts.entries, entries + 6); assert.equal(h.counts.saves, saves);
  h.fail(false);
  await p.buyMoreAsset(first.id, buy());
  assert.equal(h.snapshot().assets[0].remainingQuantity, 11);
  assert.equal(h.counts.saves, saves + 1);
});

test('injected Inzhur and Binance requests run outside the queue and sync applies to the latest holdings', { timeout: 3000 }, async t => {
  t.mock.method(global, 'fetch', () => assert.fail('A service test reached the real network.'));
  const h = memory(), a = assets(h.repository), p = purchases(h.repository);
  const asset = await a.createAsset(stock({ name: 'SPYB', ticker: 'SPYB', instrumentName: 'Binance' }));
  const catalog = gate(), catalogStarted = gate(), quote = gate(), quoteStarted = gate();
  t.after(() => { catalog.resolve([]); quote.resolve({ currentPrice: 550, underlyingSymbol: 'SPY', quoteCurrency: 'USD' }); });
  const service = sync(h.repository, {
    getInzhurCatalogAssets: async () => { assert.equal(h.insideQueue(), false); catalogStarted.resolve(); return catalog.promise; },
    getTokenizedEquityPrice: async symbol => { assert.equal(symbol, 'SPYB'); assert.equal(h.insideQueue(), false); quoteStarted.resolve(); return quote.promise; },
  });
  const operation = service.syncAssets(); await catalogStarted.promise;
  assert.equal(h.counts.entries, 1);
  await p.buyMoreAsset(asset.id, buy());
  catalog.resolve([]); await quoteStarted.promise;
  assert.equal(h.counts.entries, 2);
  await a.createAsset(stock({ name: 'Unrelated asset' }));
  quote.resolve({ currentPrice: 550, underlyingSymbol: 'SPY', quoteCurrency: 'USD' });
  const result = await operation;
  assert.equal(result.binanceSynced[0].price, 550);
  assert.equal(h.counts.entries, 4); assert.equal(h.counts.saves, 4);
  assert.equal(h.snapshot().assets[0].remainingQuantity, 11); assert.equal(h.snapshot().assets.length, 2);
  const before = h.snapshot(), entries = h.counts.entries;
  await assert.rejects(sync(h.repository, { getInzhurCatalogAssets: async () => { throw new RemoteUnavailableError(); } }).syncAssets(), { code: 'REMOTE_UNAVAILABLE' });
  assert.deepEqual(h.snapshot(), before); assert.equal(h.counts.entries, entries);
});

test('production routes cannot take the mutation queue or depend on the removed portfolio aggregator', () => {
  const root = path.resolve(__dirname, '..');
  const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  for (const file of files(path.join(root, 'routes')).filter(file => file.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\brunMutation\b|\bmutationCommands\b|\bserializeMutation\b/, path.relative(root, file));
  }
  for (const file of files(root).filter(file => file.endsWith('.js') && !file.includes(path.sep + 'tests' + path.sep))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"][^'"]*portfolioService['"]\)/, file);
    if (!file.endsWith(path.join('domain', 'mutation.js'))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /repository\.runMutation\(/, file);
  }
});
