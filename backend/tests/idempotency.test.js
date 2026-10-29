const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const model = require('../../shared/state-model');
const operations = require('../../shared/operations');
const { createServices } = require('./helpers/portfolioServices');
const { harness } = require('./helpers/nativeHarness');
const clone = value => JSON.parse(JSON.stringify(value));
const stock = () => ({ name: 'Receipt stock', type: 'stock', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01', currency: 'USD' });
function fixture() {
  return { ...model.createEmptyState(), assets: ['a', 'b'].map(id => ({ ...stock(), id })),
    transactions: ['a', 'b'].map(assetId => ({ id: 'buy-' + assetId, assetId, type: 'BUY', quantity: 10, amount: 1000, date: '2026-01-01', currency: 'USD' })),
    payments: ['p', 'q'].map(id => ({ id, assetId: 'a', type: 'DIVIDEND', amount: 10, date: '2026-11-01', currency: 'USD', status: 'planned' })) };
}
function desktop(initial = fixture()) {
  let data = clone(initial), queue = Promise.resolve(), saves = 0;
  const repository = { readData: async () => clone(data), saveData: async next => { model.validateState(next); data = clone(next); saves++; },
    runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; } };
  const services = { ...createServices(repository), ...require('../domain/transactionsService').createService(repository),
    ...require('../domain/paymentService').createService(repository), ...require('../domain/calendarService').createService(repository) };
  return { repository, services, state: () => clone(data), saves: () => saves,
    call: (kind, body, target) => kind === 'mergeAssets' ? services.mergeAssets(body.assetIds, body)
      : kind === 'createCalendarNote' ? services.createNote(body) : kind === 'createSale' ? services.sellAsset(body)
      : ['buyMoreAsset', 'markPaymentReceived'].includes(kind) ? services[kind](target, body) : services[kind](body) };
}
async function phone(t, initial = fixture()) {
  const h = harness({ local: initial }); await h.api.getData({ sync: false }); await h.drain(); h.offline(true);
  t.after(() => h.drain());
  return { h, state: () => h.local(), call: (kind, body, target) => kind === 'mergeAssets' ? h.api.mergeAssets(body.assetIds, body)
    : ['buyMoreAsset', 'markPaymentReceived'].includes(kind) ? h.api[kind](target, body) : h.api[kind](body) };
}
const scenarios = [
  ['createAsset', stock(), undefined, { purchasePrice: 101 }],
  ['buyMoreAsset', { quantity: 2, purchasePrice: 150, purchaseDate: '2026-02-01' }, 'a', { quantity: 3 }],
  ['createSale', { assetId: 'a', quantity: 2, sellPrice: 120, sellDate: '2026-02-01' }, undefined, { sellPrice: 121 }],
  ['createSale', { assetIds: ['a', 'b'], quantity: 15, sellPrice: 120, sellDate: '2026-02-01' }, undefined, { quantity: 16 }],
  ['createTransaction', { assetId: 'a', type: 'BUY', amount: 300, quantity: 2, date: '2026-02-01' }, undefined, { amount: 301 }],
  ['createTransaction', { assetId: 'a', type: 'SELL', amount: 240, quantity: 2, date: '2026-02-01' }, undefined, { quantity: 3 }],
  ['createTransaction', { assetId: 'a', paymentId: 'p', type: 'DIVIDEND', amount: 10, date: '2026-11-01' }, undefined, { amount: 11 }],
  ['createPayment', { assetId: 'a', type: 'DIVIDEND', amount: 10, date: '2026-12-01' }, undefined, { amount: 11 }],
  ['createCalendarNote', { assetId: 'a', text: 'Receipt note', amount: 1, date: '2026-02-01' }, undefined, { text: 'Different note' }],
  ['mergeAssets', { assetIds: ['a', 'b'] }, undefined, { assetIds: ['a', 'missing'] }],
  ['markPaymentReceived', {}, 'p', null],
];

test('desktop/native facts: first execution, concurrent retries, normalized replay and conflicting payload', async t => {
  for (const platform of ['desktop', 'native']) for (const [kind, input, target, changed] of scenarios) await t.test(platform + ' ' + kind + ' ' + (input.type || input.assetIds?.length || ''), async t => {
    const driver = platform === 'desktop' ? desktop() : await phone(t);
    const body = { ...input, operationId: 'operation-' + operations.newId() };
    const results = await Promise.all(Array.from({ length: 4 }, () => driver.call(kind, clone(body), target)));
    results.forEach(result => assert.deepEqual(clone(result), clone(results[0])));
    const saved = driver.state();
    assert.equal(saved.operations.length, 1);
    if (driver.saves) assert.equal(driver.saves(), 1);
    const normalized = Object.fromEntries(Object.entries(body).reverse().map(([key, value]) => [key, typeof value === 'number' ? String(value) : key === 'assetIds' ? [...value].reverse() : value]));
    assert.deepEqual(clone(await driver.call(kind, normalized, target)), clone(results[0]));
    assert.deepEqual(driver.state(), saved, 'A replay must not advance revision or change any record.');
    await assert.rejects(driver.call(kind, { ...body, ...changed }, changed === null ? 'q' : target), error => error.status === 409 && error.code === 'OPERATION_ID_CONFLICT');
    assert.deepEqual(driver.state(), saved);
    model.validateState(saved);
  });
});

test('receipts survive repository restart, native restart and complete document transfer in both directions', async t => {
  const root = path.resolve(__dirname, '../../.tmp'); await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'operation-restart-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const create = () => require('../data/repository').createRepository({ dataFile: path.join(dir, 'data.json'), drive: { isEnabled: () => false } });
  const body = { ...stock(), operationId: 'restart-operation' };
  const firstRepository = create();
  const asset = await require('../domain/assetService').createService(firstRepository).createAsset(body);
  const secondRepository = create();
  const before = await secondRepository.readData();
  assert.deepEqual(clone(await require('../domain/assetService').createService(secondRepository).createAsset(body)), clone(asset));
  assert.deepEqual(await secondRepository.readData(), before);
  const mobile = await phone(t, before);
  assert.deepEqual(clone(await mobile.call('createAsset', body)), clone(asset));
  const purchase = { quantity: 2, purchasePrice: 200, purchaseDate: '2026-02-01', operationId: 'phone-purchase' };
  const bought = await mobile.call('buyMoreAsset', purchase, asset.id);
  const restored = await phone(t, mobile.state());
  assert.deepEqual(clone(await restored.call('buyMoreAsset', purchase, asset.id)), clone(bought));
  const transferred = desktop(mobile.state());
  assert.deepEqual(clone(await transferred.call('buyMoreAsset', purchase, asset.id)), clone(bought));
  assert.equal(transferred.saves(), 0);
  const snapshot = transferred.state();
  await transferred.services.deleteAsset(asset.id);
  assert.deepEqual(clone(await transferred.call('createAsset', body)), clone(asset), 'Deleting a holding must not make its old create command execute again.');
  assert.equal(transferred.state().assets.length, 0); assert.equal(snapshot.operations.length, 2);
});

test('received transitions remain safe without operationId, with another ID and through generic income commands', async t => {
  for (const platform of ['desktop', 'native']) {
    const driver = platform === 'desktop' ? desktop() : await phone(t);
    await Promise.all(Array.from({ length: 3 }, () => driver.call('markPaymentReceived', {}, 'p')));
    const first = driver.state();
    await driver.call('markPaymentReceived', {}, 'p');
    assert.deepEqual(driver.state(), first);
    await driver.call('markPaymentReceived', { operationId: 'another-receipt-id' }, 'p');
    assert.equal(driver.state().transactions.filter(tx => tx.paymentId === 'p').length, 1);
    const income = { assetId: 'a', paymentId: 'q', type: 'DIVIDEND', amount: 10, date: '2026-11-01', operationId: 'generic-income' };
    await driver.call('createTransaction', income);
    await driver.call('markPaymentReceived', { operationId: 'same-transition' }, 'q');
    assert.equal(driver.state().transactions.filter(tx => tx.paymentId === 'q').length, 1);
    assert.equal(driver.state().transactions.find(tx => tx.paymentId === 'q').operationId, 'generic-income');
  }
});

test('explicit Drive download/upload carries receipts and replay protection across adapters', async t => {
  const backend = desktop();
  const command = { ...stock(), operationId: 'downloaded-operation' };
  const created = await backend.call('createAsset', command);
  const mobile = await phone(t);
  mobile.h.offline(false); mobile.h.changeRemote(backend.state());
  await mobile.h.api.syncGoogleDrive('download');
  assert.deepEqual(clone(await mobile.call('createAsset', command)), clone(created));
  const purchase = { quantity: 1, purchasePrice: 200, purchaseDate: '2026-02-01', operationId: 'uploaded-operation' };
  const result = await mobile.call('buyMoreAsset', purchase, created.id);
  await mobile.h.api.syncGoogleDrive('upload');
  const remote = mobile.h.remote();
  assert.equal(remote.operations.length, 2);
  const downloaded = desktop();
  Object.assign(downloaded.repository, { initializeStorage: async () => {}, readLocalData: downloaded.repository.readData,
    writeLocalData: downloaded.repository.saveData, drive: { getStatus: () => ({}), downloadData: async () => clone(remote), createManualBackup: async () => {} } });
  await require('../services/syncService').createService(downloaded.repository).syncDrive('download');
  const saves = downloaded.saves();
  assert.deepEqual(clone(await downloaded.call('buyMoreAsset', purchase, created.id)), clone(result));
  assert.equal(downloaded.saves(), saves);
});

test('client IDs distinguish new commands, retain a failed command ID and respect explicit retries', async () => {
  const seen = []; let fail = true, account = 'a';
  const service = operations.client({ createAsset: async body => { seen.push(body.operationId); if (fail) throw new Error('Lost response'); return { id: 'asset' }; } }, () => account);
  const input = stock();
  await assert.rejects(service.createAsset(input));
  fail = false; await service.createAsset(input);
  assert.equal(seen[0], seen[1]); assert.equal(input.operationId, undefined, 'The SDK must not mutate caller input.');
  await service.createAsset(input); assert.notEqual(seen[1], seen[2], 'A new acknowledged command gets a new ID.');
  fail = true; await assert.rejects(service.createAsset(input)); const previous = seen.at(-1);
  account = 'b'; await assert.rejects(service.createAsset(input)); assert.notEqual(seen.at(-1), previous);
  await assert.rejects(service.createAsset({ ...input, operationId: 'caller-key' })); assert.equal(seen.at(-1), 'caller-key');
});

test('editing a holding cannot replace its creation identity and replay still returns the original result', async t => {
  for (const platform of ['desktop', 'native']) {
    const driver = platform === 'desktop' ? desktop() : await phone(t);
    const input = { ...stock(), operationId: 'creation-identity' }, created = await driver.call('createAsset', input);
    const patch = { ...stock(), currentPrice: 170, operationId: 'forged-replacement' };
    if (driver.h) await driver.h.api.updateAsset(created.id, patch);
    else await driver.services.updateAsset(created.id, patch);
    assert.equal(driver.state().assets.find(asset => asset.id === created.id).operationId, input.operationId);
    assert.deepEqual(clone(await driver.call('createAsset', input)), clone(created));
  }
});

test('HTTP returns the original body after lost acknowledgement and rejects key reuse without a second commit', async t => {
  t.mock.method(console, 'info', () => {});
  const h = desktop(), server = require('../app').createApp({ repository: h.repository }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/assets';
  const request = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { ...stock(), operationId: 'http-operation' };
  const first = await request(body); assert.equal(first.status, 201); const asset = await first.json();
  const retry = await request({ ...body, quantity: '10', currency: ' usd ' });
  assert.equal(retry.status, 201); assert.deepEqual(await retry.json(), asset); assert.equal(h.saves(), 1);
  const conflict = await request({ ...body, quantity: 11 });
  assert.equal(conflict.status, 409); const error = await conflict.json();
  assert.deepEqual(Object.keys(error).sort(), ['category', 'code', 'error']);
  assert.equal(error.code, 'OPERATION_ID_CONFLICT'); assert.equal(error.category, 'conflict');
  assert.ok(conflict.headers.get('x-request-id')); assert.equal(h.saves(), 1);
});

test('legacy documents remain valid; invalid IDs/receipts and failed commits never reserve an operation', async () => {
  model.validateState(fixture());
  const h = desktop();
  for (const operationId of [null, false, '', 'bad key', '<html>', 'a'.repeat(129)]) {
    await assert.rejects(h.call('createAsset', { ...stock(), operationId }), { category: 'validation' });
    assert.equal(h.saves(), 0);
  }
  let failed = true;
  const save = h.repository.saveData;
  h.repository.saveData = async data => { if (failed) throw new (require('../../shared/errors').StorageError)(); return save(data); };
  // Create a new factory so it receives the failure-injected repository dependency.
  const service = require('../domain/assetService').createService(h.repository);
  const input = { ...stock(), operationId: 'failed-then-retried' };
  await assert.rejects(service.createAsset(input), { code: 'STORAGE_FAILURE' });
  assert.equal(h.state().operations, undefined);
  failed = false; await service.createAsset(input); assert.equal(h.state().operations.length, 1);
  const before = h.state();
  await assert.rejects(h.call('createPayment', { assetId: 'a', type: 'DIVIDEND', amount: 10, date: '2026-11-01', operationId: input.operationId }), { code: 'OPERATION_ID_CONFLICT' });
  assert.deepEqual(h.state(), before);
  const missingReceipt = clone(before); delete missingReceipt.operations;
  await assert.rejects(desktop(missingReceipt).call('createAsset', input), { code: 'OPERATION_RECEIPT_MISSING' });
  const corrupt = h.state(); corrupt.operations.push(clone(corrupt.operations[0]));
  assert.throws(() => model.validateState(corrupt), { category: 'validation' });
});
