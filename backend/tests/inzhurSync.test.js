const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const model = require('../../shared/market-model');
const stateModel = require('../../shared/state-model');
const { createApp } = require('../app');
const { createService } = require('../domain/marketService');
const { INZHUR_ASSETS_URL, INZHUR_CACHE_TTL_MS } = require('../config/constants');

const catalog = date => [{ type: 'bond', slug: 'test-bond', assetDetails: {
  isin: 'TEST', maturityDate: '2027-12-01', prices: { sellUAH: 1100 },
  paymentSchedule: [{ date, amount: 5000 }, { date: '2027-11-30T22:00:00.000Z', amount: 100000 }],
} }];

test('Inzhur callers share the normalized catalog and preserve null/true/false cache metadata at the TTL boundary', async t => {
  let now = Date.parse('2026-10-21T12:00:00Z'), calls = 0;
  let payload = catalog('2027-05-31T21:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, INZHUR_ASSETS_URL);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return new Response(JSON.stringify(payload));
  });
  const service = createService();
  const first = await service.getInzhurAssets();
  assert.equal(first.cached, null);
  assert.equal(first.updatedAt, new Date(now).toISOString());
  assert.deepEqual(first.assets, model.inzhurCatalog(payload));
  assert.equal(await service.getInzhurCatalogAssets(), first.assets);
  assert.equal((await service.getInzhurAssets()).cached, true);
  now += INZHUR_CACHE_TTL_MS - 1;
  assert.equal(await service.getInzhurCatalogAssets(), first.assets);
  assert.equal(calls, 1);
  now++;
  payload = catalog('2027-06-02'); payload[0].assetDetails.prices.sellUAH = 1200;
  const refreshed = await service.getInzhurAssets();
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.updatedAt, new Date(now).toISOString());
  assert.notEqual(refreshed.updatedAt, first.updatedAt);
  assert.deepEqual(refreshed.assets, model.inzhurCatalog(payload));
  assert.equal(await service.getInzhurCatalogAssets(), refreshed.assets);
  assert.equal((await service.getInzhurAssets()).cached, true);
  assert.equal(calls, 2);
});

test('an internal initial load, including an empty catalog, is a cache hit for the HTTP caller', async t => {
  for (const payload of [catalog('2027-06-01'), []]) await t.test(payload.length ? 'nonempty' : 'empty', async t => {
    let calls = 0;
    t.mock.method(global, 'fetch', async () => { calls++; return new Response(JSON.stringify(payload)); });
    const service = createService(), assets = await service.getInzhurCatalogAssets();
    assert.ok(Array.isArray(assets));
    assert.deepEqual(assets, model.inzhurCatalog(payload));
    const response = await service.getInzhurAssets();
    assert.equal(response.assets, assets);
    assert.equal(response.cached, true);
    assert.equal(calls, 1);
  });
});

test('invalid Inzhur payloads, normalization errors and failed requests never become a fresh cache', async t => {
  const networkError = Object.assign(new Error('Provider unavailable'), { status: 504, code: 'EXTERNAL_API_TIMEOUT' });
  for (const [name, invalid, expected] of [
    ['wrong shape', {}, /Inzhur API returned an invalid payload/],
    ['invalid normalized entry', catalog('2026-02-31'), /Invalid Inzhur/],
    ['request failure', networkError, error => error === networkError],
  ]) await t.test(name, async t => {
    let now = Date.parse('2026-10-21T12:00:00Z'), calls = 0, fail = true;
    const payload = catalog('2027-06-01');
    t.mock.method(Date, 'now', () => now);
    t.mock.method(global, 'fetch', async () => {
      calls++;
      if (fail && invalid instanceof Error) throw invalid;
      return new Response(JSON.stringify(fail ? invalid : payload));
    });
    const service = createService();
    await assert.rejects(service.getInzhurCatalogAssets(), expected);
    fail = false;
    const first = await service.getInzhurAssets();
    assert.equal(first.cached, null);
    assert.equal(calls, 2);
    now += INZHUR_CACHE_TTL_MS;
    fail = true;
    await assert.rejects(service.getInzhurAssets(), expected);
    fail = false;
    payload[0].assetDetails.prices.sellUAH = 1200;
    const assets = await service.getInzhurCatalogAssets();
    assert.equal(assets[0].prices.sellUAH, 1200);
    assert.notEqual(assets, first.assets);
    assert.equal(calls, 4);
    const confirmed = await service.getInzhurAssets();
    assert.equal(confirmed.assets, assets);
    assert.equal(confirmed.cached, true);
    assert.equal(confirmed.updatedAt, new Date(now).toISOString());
  });
});

test('Inzhur timestamps normalize to Ukrainian payment days without changing calendar dates', () => {
  for (const [input, expected] of [
    ['2027-06-01', '2027-06-01'], ['2027-05-31T21:00:00.000Z', '2027-06-01'],
    ['2027-01-27T22:00:00Z', '2027-01-28'], ['2027-06-01T00:00:00+03:00', '2027-06-01'],
    ['2028-02-28T22:00:00.000Z', '2028-02-29'], ['2027-06-01T10:00:00.000Z', '2027-06-01'],
  ]) {
    const payload = catalog(input), original = structuredClone(payload);
    const result = model.inzhurCatalog(payload)[0];
    assert.equal(result.paymentSchedule[0].date, expected);
    assert.equal(result.paymentSchedule[1].date, result.maturityDate);
    assert.deepEqual(payload, original, 'source records are never mutated');
  }
});

test('Inzhur normalization rejects impossible dates and malformed timestamps', () => {
  for (const date of [undefined, null, 123, '', 'invalid', '2026-02-31', '2026-02-31T22:00:00.000Z',
    '2027-06-01junk', '2027-06-01T24:00:00Z', '2027-06-01T12:00:00', '2027-06-01T12:00:00+99:00']) {
    assert.throws(() => model.inzhurCatalog(catalog(date)), /Invalid Inzhur/);
  }
  const invalid = catalog('2027-06-01'); invalid[0].assetDetails.maturityDate = '2027-02-30';
  assert.throws(() => model.inzhurCatalog(invalid), /Invalid Inzhur/);
  assert.throws(() => model.inzhurCatalog(catalog('2027-06-01').map(item => ({ ...item, assetDetails: { ...item.assetDetails, prices: { sellUAH: 'bad' } } }))), /price/);
});

test('Sync API accepts provider timestamps and preserves receipts and sale-adjusted amounts', async t => {
  let data = stateModel.createEmptyState(), saves = 0;
  data.assets.push({ id: 'bond', name: 'Bond', type: 'ovdp', isin: 'TEST', currency: 'UAH', quantity: 10, purchasePrice: 1000, purchaseDate: '2026-01-01' });
  data.transactions.push({ id: 'buy', assetId: 'bond', type: 'BUY', quantity: 10, amount: 10000, date: '2026-01-01' });
  data.sales.push({ id: 'sale', assetId: 'bond', type: 'ovdp', quantity: 5, sellPrice: 1000, sellDate: '2026-02-01' });
  const received = { id: 'receipt', assetId: 'bond', type: 'COUPON', date: '2026-03-01', amount: 500, currency: 'UAH', status: 'received' };
  data.payments.push(received);
  const repository = { initializeStorage: async () => {}, readData: async () => structuredClone(data),
    saveData: async next => { stateModel.validateState(next); data = structuredClone(next); saves++; },
    runMutation: operation => operation(), drive: { getStatus: () => ({}) } };
  const originalFetch = global.fetch;
  let sourceCalls = 0, now = Date.now();
  let sourcePayload = catalog('2027-05-31T21:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://www.inzhur.reit/_api/assets')) { sourceCalls++; return new Response(JSON.stringify(sourcePayload)); }
    return originalFetch(url, options);
  };
  t.after(() => { global.fetch = originalFetch; });
  const server = createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/api/assets/sync-inzhur', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).synced.length, 1);
  assert.equal(sourceCalls, 1); assert.equal(saves, 1); assert.equal(data.assets[0].currentPrice, 1100);
  assert.deepEqual(data.payments.find(payment => payment.id === received.id), received);
  const coupon = data.payments.find(payment => payment.status === 'planned' && payment.type === 'COUPON');
  const maturity = data.payments.find(payment => payment.status === 'planned' && payment.type === 'MATURITY');
  assert.equal(coupon.date, '2027-06-01'); assert.equal(coupon.amount, 250);
  assert.equal(maturity.date, '2027-12-01'); assert.equal(maturity.amount, 5000);
  const cached = await fetch(base + '/api/inzhur-assets');
  assert.equal(cached.status, 200);
  const body = await cached.json();
  assert.equal(body.cached, true);
  assert.equal(body.assets[0].paymentSchedule[0].date, coupon.date);
  assert.equal(sourceCalls, 1, 'HTTP reads reuse the catalog already fetched by asset synchronization');
  now += INZHUR_CACHE_TTL_MS;
  sourcePayload = {};
  const rejected = await fetch(base + '/api/inzhur-assets');
  assert.equal(rejected.status, 502);
  assert.deepEqual(await rejected.json(), { error: 'Could not load the Inzhur asset catalog.', code: 'REMOTE_UNAVAILABLE', category: 'remote_unavailable' });
  assert.ok(rejected.headers.get('x-request-id'));
  assert.equal(saves, 1, 'Failed catalog refreshes cannot write portfolio data');
  sourcePayload = catalog('2027-05-31T21:00:00.000Z');
  const refreshed = await (await fetch(base + '/api/inzhur-assets')).json();
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.updatedAt, new Date(now).toISOString());
  assert.equal(sourceCalls, 3, 'A failed HTTP refresh leaves the old cache expired and retryable');
});
