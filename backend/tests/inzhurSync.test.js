const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const model = require('../../frontend/js/market-model');
const stateModel = require('../../frontend/js/state-model');
const { createApp } = require('../app');

const catalog = date => [{ type: 'bond', slug: 'test-bond', assetDetails: {
  isin: 'TEST', maturityDate: '2027-12-01', prices: { sellUAH: 1100 },
  paymentSchedule: [{ date, amount: 5000 }, { date: '2027-11-30T22:00:00.000Z', amount: 100000 }],
} }];

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
  let sourceCalls = 0;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://www.inzhur.reit/_api/assets')) { sourceCalls++; return new Response(JSON.stringify(catalog('2027-05-31T21:00:00.000Z'))); }
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
});
