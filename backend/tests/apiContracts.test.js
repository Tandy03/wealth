const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
const model = require('../../frontend/js/state-model');
const { StorageError } = require('../../frontend/js/errors');
const { harness } = require('./helpers/nativeHarness');
const clone = value => JSON.parse(JSON.stringify(value));
const stock = (id = 'a') => ({ id, name: 'Contract stock', type: 'stock', currency: 'UAH', quantity: 10,
  purchasePrice: 100, currentPrice: 120, purchaseDate: '2026-01-01' });
const fixture = () => ({ ...model.createEmptyState(), assets: [stock(), stock('b')],
  transactions: ['a', 'b'].map(assetId => ({ id: 'buy-' + assetId, assetId, type: 'BUY', quantity: 10, amount: 1000, currency: 'UAH', date: '2026-01-01' })),
  payments: [{ id: 'planned', assetId: 'a', assetName: 'Contract stock', type: 'DIVIDEND', date: '2026-11-01', amount: 5, currency: 'UAH', status: 'planned' }] });
const plan = { targets: { 'stock::contract stock': 100 }, plannedAssets: [], excluded: [] };

async function drivers(t, initial = fixture()) {
  let saved = model.normalizeState(initial), queue = Promise.resolve(), failStorage = false;
  const repository = {
    drive: { isEnabled: () => false, getStatus: () => ({ enabled: false, connected: false }),
      uploadData: async () => {}, downloadData: async () => clone(initial), createManualBackup: async () => {}, reconnect: async () => {} },
    initializeStorage: async () => {}, readData: async () => clone(saved), readLocalData: async () => clone(saved),
    saveData: async data => { if (failStorage) throw new StorageError(); saved = model.normalizeState(data); },
    writeLocalData: async data => { if (failStorage) throw new StorageError(); saved = model.normalizeState(data); },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  };
  const server = createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const http = { async call(operation, body, id = 'a') {
    const [method, route] = paths[operation];
    const response = await fetch(base + route.replace(':id', encodeURIComponent(id)), {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error), payload, { status: response.status, requestId: response.headers.get('x-request-id') });
    return payload;
  }, state: () => clone(saved), fail: () => { failStorage = true; } };
  const phone = harness({ local: initial }); await phone.api.getData({ sync: false }); await phone.drain(); phone.offline(true);
  t.after(() => phone.drain());
  const native = { async call(operation, body, id = 'a') {
    if (['updateAsset', 'buyMoreAsset'].includes(operation)) return phone.api[operation](id, body);
    if (['deleteAsset', 'markPaymentReceived'].includes(operation)) return phone.api[operation](id);
    if (operation === 'mergeAssets') return phone.api.mergeAssets(body?.assetIds);
    if (operation === 'syncInzhurAssets') return phone.api.syncApiAssets(body);
    if (operation === 'syncGoogleDrive') return phone.api.syncGoogleDrive(body?.action ?? body?.direction);
    return phone.api[operation](body);
  }, state: () => phone.local(), fail: () => { phone.hooks.failPreference = key => key.startsWith('fino-journal-v1:'); }, phone };
  return { http, native, base };
}
const paths = {
  createAsset: ['POST', '/api/assets'], updateAsset: ['PUT', '/api/assets/:id'], mergeAssets: ['POST', '/api/assets/merge'],
  buyMoreAsset: ['POST', '/api/assets/:id/buy'], deleteAsset: ['DELETE', '/api/assets/:id'], createSale: ['POST', '/api/sales'],
  createTransaction: ['POST', '/api/transactions'], createPayment: ['POST', '/api/payments'],
  markPaymentReceived: ['PATCH', '/api/payments/:id/received'], createCalendarNote: ['POST', '/api/calendar-notes'],
  saveWallet: ['PUT', '/api/wallet'], saveRebalance: ['PUT', '/api/rebalance'],
  syncGoogleDrive: ['POST', '/api/sync/google-drive'], syncInzhurAssets: ['POST', '/api/assets/sync-inzhur'],
};
const scenarios = [
  { operation: 'createAsset', valid: stock('ignored'), invalid: [{ ...stock(), quantity: true }, { ...stock(), purchasePrice: 'NaN' },
    { ...stock(), purchaseDate: '2026-02-30' }, { ...stock(), name: '' }, { ...stock(), type: 's1_reit' },
    { ...stock(), type: 'ovdp', maturityDate: '2027-01-01', coupons: [] }], verify: result => { assert.notEqual(result.id, 'ignored'); assert.equal(result.name, 'Contract stock'); } },
  { operation: 'updateAsset', valid: { ...stock(), currentPrice: 130 }, invalid: [{ currentPrice: 130 }, { ...stock(), annualRate: -1 }, { ...stock(), purchaseDate: 'invalid' }],
    verify: result => assert.equal(result.currentPrice, 130) },
  { operation: 'mergeAssets', valid: { assetIds: ['a', 'b'] }, invalid: [{}, { assetIds: [] }, { assetIds: ['a', 'a'] }, { assetIds: [true, 'b'] }],
    verify: result => assert.equal(result.quantity, 20) },
  { operation: 'buyMoreAsset', valid: { quantity: '2.5', purchasePrice: '140', purchaseDate: '2026-02-01' },
    invalid: [{ quantity: false, purchasePrice: 140, purchaseDate: '2026-02-01' }, { quantity: 1, purchasePrice: 140, purchaseDate: '2026-02-31' }, { quantity: 0, purchasePrice: 140, purchaseDate: '2026-02-01' }],
    verify: result => { assert.deepEqual(Object.keys(result).sort(), ['asset', 'transaction']); assert.equal(result.asset.quantity, 12.5); assert.equal(result.transaction.amount, 350); } },
  { operation: 'deleteAsset', valid: undefined, invalid: [], verify: result => { assert.equal(result.success, true); assert.equal(result.asset.id, 'a'); } },
  { operation: 'createSale', valid: { assetId: 'a', quantity: 2, sellPrice: 130, sellDate: '2026-02-01' },
    invalid: [{ quantity: 2, sellPrice: 130, sellDate: '2026-02-01' }, { assetId: 'a', quantity: 1, sellPrice: true, sellDate: '2026-02-01' },
      { assetId: 'a', quantity: 100, sellPrice: 130, sellDate: '2026-02-01' }], verify: result => {
        assert.deepEqual(Object.keys(result).sort(), ['remainingQuantity', 'sale', 'transaction']); assert.equal(result.sale.costBasis, 200); assert.equal(result.remainingQuantity, 8);
      } },
  { operation: 'createTransaction', valid: { assetId: 'a', type: 'BUY', quantity: '2', amount: '240', date: '2026-02-01', currency: 'UAH', id: 'ignored' },
    invalid: [{ assetId: 'a', type: 'UNKNOWN', quantity: 1, amount: 100, date: '2026-02-01' }, { assetId: 'a', type: 'BUY', quantity: true, amount: 100, date: '2026-02-01' }],
    verify: result => { assert.notEqual(result.id, 'ignored'); assert.equal(result.status, 'completed'); assert.equal(result.amount, 240); } },
  { operation: 'createPayment', valid: { assetId: 'a', type: 'DIVIDEND', amount: '5', amountPerUnit: 0.5, date: '2026-11-01', id: 'ignored', received: true },
    invalid: [{ assetId: 'a', type: '<img>', amount: 5, date: '2026-11-01' }, { assetId: 'a', type: 'DIVIDEND', amount: true, date: '2026-11-01' },
      { assetId: 'a', type: 'DIVIDEND', amount: 5, date: '2026-11-01', status: 'received' }], verify: result => {
        assert.notEqual(result.id, 'ignored'); assert.equal(result.status, 'planned'); assert.equal(result.received, undefined); assert.equal(result.amount, 5);
      } },
  { operation: 'markPaymentReceived', id: 'planned', valid: undefined, invalid: [], verify: result => assert.equal(result.status, 'received') },
  { operation: 'createCalendarNote', valid: { assetId: 'a', date: '2026-02-01', text: '  note  ', assetName: 'forged', createdAt: 'forged' },
    invalid: [{ assetId: 'a', date: '2026-02-30', text: 'note' }, { assetId: 'a', date: '2026-02-01', text: '' }],
    verify: result => { assert.equal(result.assetName, 'Contract stock'); assert.equal(result.text, 'note'); assert.notEqual(result.createdAt, 'forged'); assert.equal(result.amount, 0); } },
  { operation: 'saveWallet', valid: { expenses: [{ date: '2026-02-01', category: ' Food ', amount: '25', note: ' lunch ' }], months: {}, loans: [] },
    invalid: [{ expenses: [], months: { '2026-01': { plans: { Food: true } } } }, { expenses: [], months: { '2026-01': { notes: ['invalid'] } } },
      { expenses: [], months: { '2026-01': { customCategories: [3] } } }], verify: result => { assert.equal(result.expenses[0].amount, 25); assert.equal(result.expenses[0].note, 'lunch'); } },
  { operation: 'saveRebalance', valid: { expected: null, plan }, invalid: [{ plan }, { expected: null, plan: { ...plan, targets: { bad: true } } }],
    verify: result => assert.deepEqual(clone(result), plan) },
];

test('HTTP and native mutations accept the same valid requests and reject bad input without partial changes', async t => {
  t.mock.method(console, 'info', () => {});
  for (const scenario of scenarios) await t.test(scenario.operation, async t => {
    const { http, native } = await drivers(t);
    for (const body of scenario.invalid) {
      for (const driver of [http, native]) {
        const before = clone(driver.state());
        await assert.rejects(driver.call(scenario.operation, clone(body), scenario.id), error => error.status === 400 && error.code === 'VALIDATION_FAILURE' && error.category === 'validation');
        assert.deepEqual(driver.state(), before);
      }
    }
    for (const driver of [http, native]) scenario.verify(await driver.call(scenario.operation, scenario.valid === undefined ? undefined : clone(scenario.valid), scenario.id));
  });
});

test('missing domain records and failed commits are atomic on HTTP and native for every financial mutation', async t => {
  t.mock.method(console, 'info', () => {});
  for (const scenario of scenarios) await t.test(scenario.operation, async t => {
    const { http, native } = await drivers(t);
    for (const driver of [http, native]) {
      if (['deleteAsset', 'markPaymentReceived', 'buyMoreAsset', 'updateAsset'].includes(scenario.operation)) {
        const before = clone(driver.state());
        await assert.rejects(driver.call(scenario.operation, scenario.valid, 'missing'), error => error.status === 404 && error.code === 'DOMAIN_FAILURE' && error.category === 'not_found');
        assert.deepEqual(driver.state(), before);
      }
      driver.fail(); const before = clone(driver.state());
      await assert.rejects(driver.call(scenario.operation, scenario.valid === undefined ? undefined : clone(scenario.valid), scenario.id), { status: 503, code: 'STORAGE_FAILURE' });
      assert.deepEqual(driver.state(), before);
    }
  });
});

test('legacy document validation stays independent from required fields of new operations', async t => {
  t.mock.method(console, 'info', () => {});
  const legacy = { assets: [{ id: 'old', type: 'ovdp', quantity: '0', custom: { retained: true } }],
    payments: [{ id: 'paid', assetId: 'old', type: 'DIVIDEND', status: 'paid', custom: true }] };
  assert.doesNotThrow(() => model.read(legacy));
  const { http, native, base } = await drivers(t, legacy);
  assert.equal((await (await fetch(base + '/api/data')).json()).assets[0].custom.retained, true);
  assert.equal((await native.phone.api.getData({ sync: false })).assets[0].custom.retained, true);
  for (const driver of [http, native]) {
    const before = clone(driver.state());
    await assert.rejects(driver.call('createAsset', clone(legacy.assets[0])), { status: 400, code: 'VALIDATION_FAILURE' });
    assert.deepEqual(driver.state(), before);
    const result = await driver.call('markPaymentReceived', undefined, 'paid'); assert.equal(result.status, 'paid');
    assert.equal(driver.state().transactions.filter(transaction => transaction.paymentId === 'paid').length, 0);
  }
});

test('domain checks, grouped sale responses and compatibility purchase aliases agree between transports', async t => {
  t.mock.method(console, 'info', () => {});
  const cases = [
    ['createCalendarNote', { assetId: 'missing', date: '2026-02-01', text: 'note' }, 404, 'DOMAIN_FAILURE'],
    ['createPayment', { assetId: 'missing', type: 'DIVIDEND', date: '2026-11-01', amount: 1 }, 404, 'DOMAIN_FAILURE'],
    ['createTransaction', { assetId: 'missing', type: 'BUY', date: '2026-02-01', quantity: 1, amount: 100 }, 404, 'DOMAIN_FAILURE'],
    ['createTransaction', { assetId: 'a', type: 'DIVIDEND', date: '2026-02-01', amount: 1, paymentId: 'missing' }, 400, 'VALIDATION_FAILURE'],
    ['mergeAssets', { assetIds: ['a', 'missing'] }, 404, 'DOMAIN_FAILURE'],
    ['buyMoreAsset', { quantity: 1, purchasePrice: 100, purchaseDate: '2026-02-01', currency: 'EUR' }, 400, 'VALIDATION_FAILURE'],
    ['createSale', { assetId: 'a', quantity: 1, sellPrice: 120, sellDate: '2026-02-01', currency: 'EUR' }, 400, 'VALIDATION_FAILURE'],
    ['saveRebalance', { plan, expected: { ...plan, targets: {} } }, 409, 'SYNC_CONFLICT'],
  ];
  const { http, native } = await drivers(t);
  for (const [operation, body, status, code] of cases) for (const driver of [http, native]) {
    const before = clone(driver.state());
    await assert.rejects(driver.call(operation, clone(body)), { status, code }); assert.deepEqual(driver.state(), before);
  }
  for (const driver of [http, native]) {
    const purchase = await driver.call('buyMoreAsset', { quantity: 1, price: 150, date: '2026-02-01' });
    assert.equal(purchase.transaction.amount, 150); assert.equal(purchase.asset.quantity, 11);
    const sale = await driver.call('createSale', { assetIds: ['a', 'b'], quantity: 12, sellPrice: 130, sellDate: '2026-03-01' });
    assert.deepEqual(Object.keys(sale).sort(), ['remainingQuantity', 'sales', 'transactions']);
    assert.equal(sale.sales.length, 2); assert.equal(sale.remainingQuantity, 9);
  }
});

test('sync mutations and session renewal keep their documented success/failure contracts without rejected writes', async t => {
  t.mock.method(console, 'info', () => {});
  t.mock.method(require('../domain/marketService'), 'createService', () => ({ getInzhurCatalogAssets: async () => [] }));
  const { http, native, base } = await drivers(t);
  for (const driver of [http, native]) {
    const before = clone(driver.state());
    await assert.rejects(driver.call('syncGoogleDrive', { action: 'invalid' }), { status: 400, code: 'VALIDATION_FAILURE' });
    await assert.rejects(driver.call('syncInzhurAssets', []), { status: 400, code: 'VALIDATION_FAILURE' });
    assert.deepEqual(driver.state(), before);
    if (driver.phone) driver.phone.offline(false);
    const assets = await driver.call('syncInzhurAssets');
    for (const field of ['synced', 'skipped', 'binanceSynced', 'binanceSkipped']) assert.ok(Array.isArray(assets[field]));
    const sync = await driver.call('syncGoogleDrive', { action: 'backup' });
    assert.equal(sync.success, true); assert.equal(sync.action, 'backup'); assert.equal(sync.backupSaved, true);
  }
  const before = http.state();
  const denied = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: base } });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'DOMAIN_FAILURE'); assert.deepEqual(http.state(), before);
  const session = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: base, 'X-Fino-Session': 'renew' } });
  assert.equal(session.status, 204); assert.match(session.headers.get('set-cookie'), /HttpOnly/i); assert.deepEqual(http.state(), before);
});

test('desktop and native reject malformed query parameters before any provider request', async t => {
  const desktop = require('../../frontend/js/api/desktop').createService({ request: async () => assert.fail('invalid query reached transport') });
  const h = harness({ proxy: true });
  const cases = [
    ['getCurrencyHistory', { code: ['USD'], startDate: '2026-01-01', endDate: '2026-02-01' }],
    ['getCurrencyHistory', { code: 'USD', startDate: '2026-02-30', endDate: '2026-03-01' }],
    ['getFrankfurterHistory', { ticker: {}, startDate: '2026-01-01', endDate: '2026-02-01' }],
    ['getMarketTimeSeries', { symbol: 'AAPL', outputsize: true }],
    ['getMarketTimeSeries', { symbol: 'AAPL', outputsize: 5001 }],
    ['getIndexHistory', { symbol: '.INX', startDate: '2026-02-01', endDate: '2026-01-01' }],
    ['getIndexHistory', { symbol: '.INX', unexpected: 'extra' }],
    ['getData', { sync: 'true' }],
  ];
  const calls = h.hooks.driveCalls || 0;
  for (const [method, params] of cases) for (const api of [desktop, h.api]) {
    await assert.rejects(api[method](clone(params)), error => error.status === 400 && error.code === 'VALIDATION_FAILURE' && error.category === 'validation' && Boolean(error.requestId));
  }
  assert.equal(h.hooks.driveCalls || 0, calls);
});

test('both SDKs reject non-string identifiers before encoding or touching saved state', async () => {
  const desktop = require('../../frontend/js/api/desktop').createService({ request: async () => assert.fail('bad identifier reached HTTP') });
  const h = harness(); await h.api.getData({ sync: false }); await h.drain(); const before = h.local();
  for (const id of [undefined, null, false, 123, {}, [], '', ' ']) for (const api of [desktop, h.api]) {
    for (const method of ['deleteAsset', 'markPaymentReceived']) await assert.rejects(api[method](id), { status: 400, code: 'VALIDATION_FAILURE', category: 'validation' });
  }
  assert.deepEqual(h.local(), before);
});

test('a grouped sale checks withdrawal restrictions on every position before changing either snapshot', async t => {
  t.mock.method(console, 'info', () => {});
  const initial = fixture(); initial.payments = [];
  initial.assets = initial.assets.map((asset, index) => ({ ...asset, type: 'deposit', earlyWithdrawal: index === 0,
    maturityDate: '2027-01-01', annualRate: 5 }));
  const { http, native } = await drivers(t, initial);
  for (const driver of [http, native]) {
    const before = clone(driver.state());
    await assert.rejects(driver.call('createSale', { assetIds: ['a', 'b'], quantity: 12, sellPrice: 130, sellDate: '2026-02-01' }),
      { status: 400, code: 'VALIDATION_FAILURE', category: 'validation' });
    assert.deepEqual(driver.state(), before);
  }
});

test('currency-history defaults use the same valid calendar range on leap days', async t => {
  const range = require('../validators/requests').currencyHistoryRange;
  assert.deepEqual(range({ endDate: '2028-02-29' }), { startDate: '2027-02-28', endDate: '2028-02-29' });
  assert.throws(() => range({ endDate: '2026-02-30' }), { code: 'VALIDATION_FAILURE' });
  assert.throws(() => range({ startDate: '2028-03-01', endDate: '2028-02-29' }), { code: 'VALIDATION_FAILURE' });
  const h = harness();
  h.hooks.externalFetch = async url => {
    assert.equal(url.searchParams.get('start'), '20270228'); assert.equal(url.searchParams.get('end'), '20280229');
    return new Response(JSON.stringify([{ exchangedate: '29.02.2028', rate: 40 }]));
  };
  const result = await h.api.getCurrencyHistory({ code: 'USD', endDate: '2028-02-29' });
  assert.equal(result.values[0].datetime, '2028-02-29');
});
