const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { createOutbox } = require('../../frontend/js/api/outbox');
const desktopApi = require('../../frontend/js/api/desktop');
const fetchers = require('../../frontend/js/api/fetchers');
const errors = require('../../shared/errors');
const model = require('../../shared/state-model');
const { harness } = require('./helpers/nativeHarness');
const clone = value => JSON.parse(JSON.stringify(value));
const stock = () => ({ name: 'Recovery stock', type: 'stock', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01', currency: 'USD' });
function memory() {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
const context = (storage, scope = 'desktop:http://localhost:3000') => async () => ({ storage, scope });
function pending(body, key = 'buy-form:buyMoreAsset') { Object.defineProperty(body, 'commandIntent', { value: { key, signature: JSON.stringify(body) } }); return body; }
const purchase = id => ({ quantity: 2, purchasePrice: 150, purchaseDate: '2026-02-01', operationId: id });

for (const kind of ['purchase', 'grouped sale']) test(`desktop restart recovers ${kind} after real HTTP commit and lost response, with one repository/journal fact`, async t => {
  t.mock.method(console, 'info', () => {});
  const root = path.resolve(__dirname, '../../.tmp'); await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'outbox-http-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json'), drive = { isEnabled: () => false };
  let repository = require('../data/repository').createRepository({ dataFile, drive });
  const assets = require('../domain/assetService').createService(repository);
  const a = await assets.createAsset(stock()), b = await assets.createAsset(stock());
  let server = require('../app').createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  let base = 'http://127.0.0.1:' + server.address().port;
  const storage = memory(), scope = 'desktop:' + base, sent = [];
  const endpoint = kind === 'purchase' ? `/api/assets/${a.id}/buy` : '/api/sales';
  let lost = true;
  function client() {
    const outbox = createOutbox({ getContext: context(storage, scope) });
    const transport = fetchers.createService({ fetch: async (url, options) => {
      if (url === endpoint) {
        const saved = JSON.parse([...storage.values.values()][0]).entries[0];
        assert.equal(saved.state, 'in-flight', 'Outbox must be durable before HTTP is invoked.');
        assert.deepEqual(saved.body, JSON.parse(options.body)); sent.push(JSON.parse(options.body));
      }
      const response = await fetch(base + url, { ...options, headers: { ...options.headers, Connection: 'close' } });
      if (url === endpoint && lost) { lost = false; await response.text(); throw new TypeError('Lost acknowledgement after commit'); }
      return response;
    } });
    return outbox.wrap(desktopApi.createService(transport));
  }
  const body = kind === 'purchase' ? purchase('durable-purchase') : { assetIds: [a.id, b.id], quantity: 15, sellPrice: 125, sellDate: '2026-02-01', operationId: 'durable-sale' };
  const first = client();
  await assert.rejects(kind === 'purchase' ? first.buyMoreAsset(a.id, body) : first.createSale(body), { category: 'remote_unavailable' });
  const status = await first.outbox.list(); assert.equal(status.entries[0].state, 'outcome-unknown');
  const committed = await repository.readData(), receipt = committed.operations[0], history = (await repository.journalHistory()).length;
  // Restart backend storage and client transport on the same origin/port.
  await new Promise(resolve => server.close(resolve));
  repository = require('../data/repository').createRepository({ dataFile, drive });
  server = require('../app').createApp({ repository }).listen(port, '127.0.0.1'); await once(server, 'listening');
  const restarted = client();
  const result = await restarted.outbox.retry(body.operationId, status.scope);
  assert.deepEqual(clone(result), receipt.result); assert.deepEqual(sent[0], sent[1]);
  assert.equal((await restarted.outbox.list()).entries.length, 0);
  assert.equal((await repository.journalHistory()).length, history);
  assert.deepEqual(await repository.readData(), committed);
  assert.equal(committed.transactions.filter(item => item.operationId === body.operationId).length, kind === 'purchase' ? 1 : 2);
});

test('native restart reuses exact ID/payload from account-scoped storage and does not create a second fact or upload', async t => {
  const first = harness(); await first.api.getData({ sync: false }); await first.drain();
  const getContext = adapter => async () => ({ ...await adapter.getCommandContext(), storage: adapter.commandStorage });
  let lost = true;
  const outbox = createOutbox({ getContext: getContext(first.api) });
  const service = outbox.wrap({ buyMoreAsset: async (...args) => {
    const result = await first.api.buyMoreAsset(...args);
    if (lost) { lost = false; throw new TypeError('Acknowledgement lost after native journal commit'); }
    return result;
  } });
  const body = purchase('native-recovery'); body.currency = 'UAH'; body.purchasePrice = 1000;
  await assert.rejects(service.buyMoreAsset('bond', body), { category: 'remote_unavailable' });
  await first.drain(); const snapshot = first.local();
  const entry = (await service.outbox.list()).entries[0];
  const second = harness({ storage: first.storage, remote: first.remote() });
  const restored = createOutbox({ getContext: getContext(second.api) }).wrap(second.api);
  const result = await restored.outbox.retry(entry.operationId, entry.scope);
  assert.deepEqual(clone(result), snapshot.operations[0].result);
  assert.deepEqual(second.local(), snapshot);
  assert.equal((await restored.outbox.list()).entries.length, 0);
  await second.drain(); assert.equal(second.uploads.length, 0);
  assert.equal(snapshot.transactions.filter(item => item.operationId === body.operationId).length, 1);
  t.after(() => Promise.all([first.drain(), second.drain()]));
});

test('unknown command stays in its origin/account scope, and edited input cannot create a replacement intent', async () => {
  const storage = memory(); let scope = 'desktop:http://localhost:3000', calls = 0, lost = true;
  const outbox = createOutbox({ getContext: async () => ({ storage, scope }) });
  const api = outbox.wrap({ buyMoreAsset: async (_id, body) => { calls++; if (lost) throw new TypeError('offline'); return { id: body.operationId }; } });
  await assert.rejects(api.buyMoreAsset('a', pending(purchase('original'))));
  const original = (await api.outbox.list()).entries[0];
  await assert.rejects(api.buyMoreAsset('a', pending({ ...purchase('edited'), quantity: 3 })), { code: 'OUTBOX_PENDING_COMMAND' });
  assert.equal(calls, 1);
  scope = 'desktop:http://localhost:3001'; assert.equal((await api.outbox.list()).entries.length, 0);
  await assert.rejects(api.outbox.retry('original', original.scope), { code: 'OUTBOX_SCOPE_CHANGED' }); assert.equal(calls, 1);
  scope = original.scope; lost = false;
  assert.deepEqual(await api.outbox.retry('original', original.scope), { id: 'original' });
  assert.equal((await api.outbox.list()).entries.length, 0);
});

test('native account switch hides but preserves the old outbox until that exact local account returns', async () => {
  const first = harness(); await first.api.getData({ sync: false }); first.offline(true);
  const create = adapter => createOutbox({ getContext: async () => ({ ...await adapter.getCommandContext(), storage: adapter.commandStorage }) });
  const api = create(first.api).wrap({ buyMoreAsset: async () => { throw new TypeError('unknown'); } });
  await assert.rejects(api.buyMoreAsset('bond', purchase('account-bound')));
  const original = await api.outbox.list();
  first.storage.set('fino-active-account', 'other@example.com');
  first.storage.set('fino-data-v1:other%40example.com', JSON.stringify(model.createEmptyState()));
  const other = harness({ storage: first.storage }); other.offline(true);
  const second = create(other.api).wrap(other.api);
  assert.equal((await second.outbox.list()).entries.length, 0);
  await assert.rejects(second.outbox.retry('account-bound', original.scope), { code: 'OUTBOX_SCOPE_CHANGED' });
  first.storage.set('fino-active-account', 'test@example.com');
  const returned = harness({ storage: first.storage }); returned.offline(true);
  assert.equal((await create(returned.api).list()).entries[0].operationId, 'account-bound');
  await Promise.all([first.drain(), other.drain(), returned.drain()]);
});

test('rejected commands never retry automatically, new IDs remain independent, and caller mutations cannot alter a saved request', async () => {
  const storage = memory(); let calls = 0, reject = true;
  const api = createOutbox({ getContext: context(storage) }).wrap({ buyMoreAsset: async (_id, body) => {
    calls++; if (reject) throw new errors.ValidationError(); return { id: body.operationId, quantity: body.quantity };
  } });
  const body = pending(purchase('rejected')), saved = clone(body), promise = api.buyMoreAsset('a', body); body.quantity = 999;
  await assert.rejects(promise, { category: 'validation' });
  const status = await api.outbox.list(); assert.deepEqual(status.entries[0].body, saved); assert.equal(status.entries[0].state, 'rejected');
  await assert.rejects(api.outbox.retry('rejected', status.scope), { code: 'OUTBOX_COMMAND_REJECTED' }); assert.equal(calls, 1);
  reject = false; await api.buyMoreAsset('a', pending(purchase('intentional-new'))); assert.equal(calls, 2);
  assert.equal((await api.outbox.list()).entries.length, 1);
});

test('corrupt or credential-bearing records are preserved and never executed; failed local writes prevent dispatch', async () => {
  const storage = memory(); let calls = 0;
  const api = createOutbox({ getContext: context(storage) }).wrap({ buyMoreAsset: async () => { calls++; throw new TypeError('offline'); } });
  await assert.rejects(api.buyMoreAsset('a', purchase('corrupt')));
  const key = [...storage.values.keys()][0], document = JSON.parse(storage.getItem(key)); document.entries[0].body.quantity = 'not-a-number';
  storage.setItem(key, JSON.stringify(document)); const raw = storage.getItem(key);
  assert.equal((await api.outbox.list()).code, 'OUTBOX_CORRUPT_RECORD');
  await assert.rejects(api.buyMoreAsset('a', purchase('new')), { code: 'OUTBOX_CORRUPT_RECORD' }); assert.equal(calls, 1); assert.equal(storage.getItem(key), raw);
  const fresh = memory(); fresh.setItem = () => { throw new Error('local quota'); };
  const blocked = createOutbox({ getContext: context(fresh) }).wrap({ buyMoreAsset: async () => { calls++; } });
  await assert.rejects(blocked.buyMoreAsset('a', purchase('quota')), { code: 'OUTBOX_STORAGE_FAILURE', category: 'storage_failure' }); assert.equal(calls, 1);
  const clean = createOutbox({ getContext: context(memory()) }).wrap({ buyMoreAsset: async () => { calls++; } });
  await assert.rejects(clean.buyMoreAsset('a', { ...purchase('unsafe'), accessToken: 'never-store' }), { code: 'OUTBOX_INVALID_COMMAND' }); assert.equal(calls, 1);
  await assert.rejects(clean.buyMoreAsset('a', { ...purchase('unsafe-key'), apiKey: 'never-store' }), { code: 'OUTBOX_INVALID_COMMAND' }); assert.equal(calls, 1);
  await assert.rejects(clean.buyMoreAsset('a', purchase('')), { code: 'VALIDATION_FAILURE' }); assert.equal(calls, 1);
  const unavailable = createOutbox({ getContext: async () => { throw new Error('private storage diagnostic'); } });
  await assert.rejects(unavailable.list(), error => error.code === 'OUTBOX_STORAGE_FAILURE' && error.category === 'storage_failure' && !error.message.includes('private storage'));
});

test('expired replay is marked completed, reloads once, and never creates a fresh operation ID', async () => {
  let calls = 0, reloads = 0; const storage = memory();
  const api = createOutbox({ getContext: context(storage), onExpired: async () => { reloads++; } }).wrap({ buyMoreAsset: async () => {
    calls++; throw new errors.ConflictError({ code: 'OPERATION_RESULT_EXPIRED' });
  } });
  await assert.rejects(api.buyMoreAsset('a', purchase('expired')), { code: 'OPERATION_RESULT_EXPIRED' });
  const status = await api.outbox.list(); assert.equal(status.entries[0].state, 'confirmed'); assert.equal(status.entries[0].lastErrorCode, 'OPERATION_RESULT_EXPIRED');
  await assert.rejects(api.outbox.retry('expired', status.scope), { code: 'OUTBOX_COMMAND_REJECTED' });
  assert.equal(calls, 1); assert.equal(reloads, 1);
});

test('a crash during dispatch recovers in-flight as outcome-unknown; different payloads cannot share an active ID', async () => {
  const storage = memory(); let release;
  const api = createOutbox({ getContext: context(storage) }).wrap({ buyMoreAsset: async () => new Promise(resolve => { release = resolve; }) });
  const first = api.buyMoreAsset('a', purchase('in-flight'));
  while (!release) await new Promise(setImmediate);
  await assert.rejects(api.buyMoreAsset('a', { ...purchase('in-flight'), quantity: 3 }), { code: 'OPERATION_ID_CONFLICT' });
  const restarted = createOutbox({ getContext: context(storage) });
  const status = await restarted.list(); assert.equal(status.entries[0].state, 'outcome-unknown');
  release({ id: 'confirmed' }); await first;
  assert.equal((await restarted.list()).entries.length, 0);
});

test('identical financial fields with intentional distinct IDs remain separate commands', async () => {
  let facts = 0;
  const api = createOutbox({ getContext: context(memory()) }).wrap({ buyMoreAsset: async () => ({ number: ++facts }) });
  assert.deepEqual(await api.buyMoreAsset('a', purchase('first')), { number: 1 });
  assert.deepEqual(await api.buyMoreAsset('a', purchase('second')), { number: 2 });
  assert.equal((await api.outbox.list()).entries.length, 0);
});

test('a confirmed result survives cleanup failure without resending, and account change preserves its original scope record', async () => {
  const storage = memory(); let cleanupFails = true, scope = 'android:a:local-a', calls = 0;
  const set = storage.setItem;
  storage.setItem = (key, value) => { if (cleanupFails && JSON.parse(value).entries?.length === 0) throw new Error('cleanup failed'); set(key, value); };
  const create = () => createOutbox({ getContext: async () => { const expected = scope; return { scope, storage, isCurrent: () => scope === expected }; } });
  const api = create().wrap({ buyMoreAsset: async () => ({ id: 'result-' + (++calls) }) });
  assert.deepEqual(await api.buyMoreAsset('a', purchase('acknowledged')), { id: 'result-1' });
  const completed = await api.outbox.list(); assert.equal(completed.entries[0].state, 'confirmed');
  const restart = create().wrap({ buyMoreAsset: async () => { calls++; } });
  assert.deepEqual(await restart.buyMoreAsset('a', purchase('acknowledged')), { id: 'result-1' }); assert.equal(calls, 1);
  cleanupFails = false; await restart.outbox.dismiss('acknowledged', completed.scope);
  let finish;
  const switching = create().wrap({ buyMoreAsset: async () => new Promise(resolve => { finish = resolve; }) });
  const pending = switching.buyMoreAsset('a', purchase('switching'));
  while (!finish) await new Promise(setImmediate);
  scope = 'android:b:local-b'; finish({ id: 'account-a-result' });
  await assert.rejects(pending, { code: 'OUTBOX_SCOPE_CHANGED' }); assert.equal((await switching.outbox.list()).entries.length, 0);
  scope = 'android:a:local-a';
  assert.equal((await switching.outbox.list()).entries[0].state, 'confirmed');
});

test('an account switch while resolving command scope cannot bind an old form to the new account', async () => {
  const storage = memory(); let scope = 'account-a', calls = 0;
  const api = createOutbox({ getScope: () => scope, getContext: async () => { scope = 'account-b'; return { scope, storage }; } })
    .wrap({ createAsset: async () => { calls++; } });
  await assert.rejects(api.createAsset({ ...stock(), operationId: 'old-form' }), { code: 'OUTBOX_SCOPE_CHANGED' });
  assert.equal(calls, 0); assert.equal(storage.values.size, 0);
});

test('SDK retry without an explicit ID retains identity and refuses caller edits while the outcome is unknown', async () => {
  const ids = [], storage = memory(); let lose = true;
  const api = createOutbox({ getContext: context(storage) }).wrap({ buyMoreAsset: async (_id, body) => {
    ids.push(body.operationId); if (lose) { lose = false; throw new TypeError('lost response'); } return { id: 'same-result' };
  } });
  const input = { quantity: 2, purchasePrice: 100, purchaseDate: '2026-01-01' };
  await assert.rejects(api.buyMoreAsset('a', input)); assert.equal(input.operationId, undefined);
  input.quantity = 3; await assert.rejects(api.buyMoreAsset('a', input), { code: 'OUTBOX_PENDING_COMMAND' });
  input.quantity = 2; await api.buyMoreAsset('a', input); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  await api.buyMoreAsset('a', input); assert.notEqual(ids[1], ids[2]);
});
