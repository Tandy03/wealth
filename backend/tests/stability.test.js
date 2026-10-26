const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createEmptyState, normalizeState } = require('../../shared/state-model');
const { createRepository } = require('../data/repository');
const { createServices: createService } = require('./helpers/portfolioServices');
const { validateRequest, validateWallet, validateQuery } = require('../validators/requests');
const holding = () => ({ name: 'Test', type: 'stock', currency: 'USD', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01' });
function memoryRepository() {
  let stored = createEmptyState();
  let queue = Promise.resolve();
  return {
    readData: async () => structuredClone(stored),
    saveData: async value => { stored = normalizeState(value); },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  };
}
test('domain scenarios work against memory storage and rejection preserves financial state', async () => {
  const repository = memoryRepository();
  const portfolio = createService(repository);
  const asset = await portfolio.createAsset(holding());
  const bought = await portfolio.buyMoreAsset(asset.id, { quantity: 2, purchasePrice: 160, purchaseDate: '2026-02-01' });
  assert.equal(bought.asset.quantity, 12);
  assert.equal(bought.asset.purchasePrice, 110);
  const sold = await portfolio.sellAsset({ assetId: asset.id, quantity: 2, sellPrice: 120, sellDate: '2026-03-01' });
  assert.equal(sold.sale.profit, 20);
  const before = await repository.readData();
  for (const patch of [{ quantity: 11 }, { sellPrice: 'oops' }, { sellPrice: true }, { sellDate: '2026-02-30' }, { currency: 'XYZ' }]) {
    await assert.rejects(portfolio.sellAsset({ assetId: asset.id, quantity: 1, sellPrice: 120, sellDate: '2026-03-01', ...patch }));
    assert.deepEqual(await repository.readData(), before);
  }
  const payments = require('../domain/paymentService').createService(repository);
  const payment = await payments.createPayment({ assetId: asset.id, type: 'DIVIDEND', date: '2026-03-01', amount: 5, currency: 'USD' });
  await payments.markPaymentReceived(payment.id);
  await payments.markPaymentReceived(payment.id);
  assert.equal((await repository.readData()).transactions.filter(item => item.paymentId === payment.id).length, 1);
  const wallet = require('../domain/walletService').createService(repository);
  await wallet.saveWallet({ expenses: [{ date: '2026-03-01', category: 'Food', amount: '20' }], months: {}, loans: [] });
  const saved = await repository.readData();
  await assert.rejects(wallet.saveWallet({ expenses: [{ date: '2026-02-30', category: 'Food', amount: 20 }], months: {} }));
  assert.deepEqual(await repository.readData(), saved);
});
test('strict request validation rejects coercion, malformed nested values and impossible dates', () => {
  for (const purchasePrice of [null, true, {}, [], '', ' ', 'NaN', Infinity, -1]) assert.throws(() => validateRequest('asset', { ...holding(), purchasePrice }));
  for (const purchaseDate of ['2026-02-30', '2026-13-01', '2026-1-01', '2025-02-29']) assert.throws(() => validateRequest('asset', { ...holding(), purchaseDate }));
  assert.doesNotThrow(() => validateRequest('asset', { ...holding(), purchaseDate: '2024-02-29', purchasePrice: '100' }));
  assert.throws(() => validateRequest('asset', { ...holding(), coupons: [{ date: '2026-02-30', amountPerUnit: 1 }] }));
  assert.throws(() => validateWallet({ expenses: [], months: { '2026-13': {} } }));
  assert.throws(() => validateWallet({ expenses: [], months: { '2026-01': { plans: { Food: true } } } }));
  assert.throws(() => validateQuery({ startDate: '2026-02-30' }));
  assert.throws(() => validateQuery({ symbol: ['AAPL', 'MSFT'] }));
  assert.throws(() => validateQuery({ startDate: '2026-03-01', endDate: '2026-02-01' }));
});
test('rename failure preserves disk snapshot, caller revision and cleans temporary files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-rollback-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const repository = createRepository({ dataFile, drive: { isEnabled: () => false } });
  const state = await repository.readData();
  const before = await fs.readFile(dataFile, 'utf8');
  const sync = structuredClone(state.sync);
  const mocked = t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('Simulated disk failure'), { code: 'EIO' }); });
  await assert.rejects(repository.saveData(state), error => error.status === 503 && error.category === 'storage_failure' && error.cause.code === 'EIO');
  assert.deepEqual(state.sync, sync);
  assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  assert.deepEqual(await fs.readdir(dir), ['data.json', 'data.json.journal.ndjson']);
  mocked.mock.restore();
  await repository.saveData(state);
  assert.equal(state.sync.revision, sync.revision + 1);
});
test('upload queue failure keeps committed local data usable', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-queue-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const drive = { isEnabled: () => false, queueUpload: () => { throw new Error('Offline'); } };
  const repository = createRepository({ dataFile: path.join(dir, 'data.json'), drive });
  const state = await repository.readData();
  drive.isEnabled = () => true;
  state.wallet.months['2026-01'] = { plans: { Food: 20 } };
  await repository.saveData(state);
  assert.equal((await repository.readData()).wallet.months['2026-01'].plans.Food, 20);
});
test('HTTP malformed JSON, rejected mutations and conflicts have stable error categories', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-http-stability-'));
  const drive = { isEnabled: () => false, getStatus: () => ({ conflict: true }), uploadData: async () => { throw Object.assign(new Error('Conflict'), { code: 'GOOGLE_DRIVE_CONFLICT' }); } };
  const repository = createRepository({ dataFile: path.join(dir, 'data.json'), drive });
  const server = require('../app').createApp({ repository }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const invalidJson = await post('/api/assets', '{broken');
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.headers.get('x-error-category'), 'validation');
  assert.ok(invalidJson.headers.get('x-request-id'));
  assert.equal((await invalidJson.json()).error, 'Request body must be valid JSON.');
  const before = await repository.readData();
  const invalid = await post('/api/assets', JSON.stringify({ ...holding(), purchasePrice: true }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await repository.readData(), before);
  assert.equal((await post('/api/sync/google-drive', JSON.stringify({ action: 'invalid' }))).status, 400);
  const conflict = await post('/api/sync/google-drive', JSON.stringify({ action: 'upload' }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get('x-error-category'), 'conflict');
  assert.equal((await fetch(base + '/api/market-data/time-series?symbol=AAPL&symbol=MSFT')).status, 400);
  const readFile = fs.readFile;
  const failure = t.mock.method(fs, 'readFile', async (file, ...args) => {
    if (file === path.join(dir, 'data.json')) throw Object.assign(new Error('Simulated read failure'), { code: 'EIO' });
    return readFile(file, ...args);
  });
  const unavailable = await fetch(base + '/api/data');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('x-error-category'), 'storage_failure');
  failure.mock.restore();
  assert.deepEqual(await repository.readData(), before);
});
