const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRepository } = require('../data/repository');
const { createService } = require('../domain/assetService');

test('local reads, status and edits remain available while Drive initialization is stalled', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-local-first-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const local = require('../../shared/state-model').createEmptyState();
  await fs.writeFile(dataFile, JSON.stringify(local));
  let release, began, failure;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { began = resolve; });
  const queued = [];
  const repository = createRepository({ dataFile, drive: {
    isEnabled: () => true, getStatus: () => ({ conflict: Boolean(failure) }), markLocalSaved() {},
    initialize: async () => { began(); await gate; return { source: 'google-drive', data: { ...local, assets: [{ id: 'remote' }] } }; },
    queueUpload: snapshot => queued.push(structuredClone(snapshot)), recordFailure: error => { failure = error; },
  } });
  let timer;
  try {
    await Promise.race([(async () => {
      assert.equal((await repository.readData()).assets.length, 0); await started;
      const status = await require('../services/syncService').createService(repository).getDriveStatus();
      assert.equal(status.savedLocally, true);
      await repository.runMutation(async () => {
        const data = await repository.readData(); data.calendarNotes.push({ id: 'new', date: '2026-10-17' });
        await repository.saveData(data);
      });
      assert.equal((await repository.readData()).calendarNotes.length, 1);
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Drive initialization blocked local data')), 1000); })]);
  } finally { clearTimeout(timer); release(); await repository.waitForRemoteInitialization(); }
  assert.equal(failure.code, 'SYNC_CONFLICT');
  assert.equal((await repository.readData()).calendarNotes.length, 1);
  assert.equal((await repository.readData()).assets.length, 0);
  assert.equal(queued.length, 0, 'a conflicting remote copy cannot trigger an automatic replacement');
});

test('edits made during initialization upload the latest version when the remote baseline is unchanged', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-init-latest-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const local = require('../../shared/state-model').createEmptyState();
  await fs.writeFile(dataFile, JSON.stringify(local));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const uploaded = [];
  const repository = createRepository({ dataFile, drive: {
    isEnabled: () => true, markLocalSaved() {}, getStatus: () => ({}),
    initialize: async data => { await gate; return { source: 'google-drive', data }; }, confirmDownload: async () => {},
    queueUpload: data => uploaded.push(structuredClone(data)),
  } });
  const data = await repository.readData();
  data.calendarNotes.push({ id: 'local', date: '2026-10-17' }); await repository.saveData(data);
  release(); await repository.waitForRemoteInitialization();
  assert.equal(uploaded.length, 1); assert.equal(uploaded[0].calendarNotes[0].id, 'local');
  assert.equal((await repository.readData()).calendarNotes[0].id, 'local');
});

test('HTTP startup serves local data immediately and refreshes after background Drive initialization', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-http-local-first-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const local = require('../../shared/state-model').createEmptyState();
  await fs.writeFile(dataFile, JSON.stringify(local));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const remote = { ...local, assets: [{ id: 'remote', name: 'Remote holding' }] };
  const repository = createRepository({ dataFile, drive: {
    isEnabled: () => true, getStatus: () => ({}), markLocalSaved() {}, queueUpload() {}, uploadData: async () => {},
    initialize: async () => { await gate; return { source: 'google-drive', data: remote }; },
  } });
  const server = require('../app').createApp({ repository }).listen(0, '127.0.0.1');
  await require('node:events').once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/api/data', { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200); assert.equal((await response.json()).assets.length, 0);
    const refreshing = fetch(base + '/api/data?sync=true', { signal: AbortSignal.timeout(3000) });
    const status = await fetch(base + '/api/sync/status', { signal: AbortSignal.timeout(1000) });
    assert.equal(status.status, 200); assert.equal((await status.json()).savedLocally, true);
    release();
    const refreshed = await refreshing; assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).assets[0].id, 'remote');
  } finally { release(); await repository.waitForRemoteInitialization(); }
});

test('failed initialization upload retains the committed remote snapshot', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-init-upload-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const local = { assets: [{ id: 'local', name: 'Old local' }] };
  const remote = { assets: [{ id: 'remote', name: 'Downloaded' }], custom: { preserved: true } };
  await fs.writeFile(dataFile, JSON.stringify(local));
  let attempts = 0;
  const repository = createRepository({ dataFile, drive: {
    isEnabled: () => true,
    initialize: async () => ({ source: 'google-drive', data: structuredClone(remote) }),
    uploadData: async () => { attempts++; throw new Error('offline'); },
  } });
  await repository.initializeStorage(); await repository.waitForRemoteInitialization();
  const first = await repository.readData();
  assert.equal(attempts, 1);
  assert.deepEqual(first.assets, remote.assets);
  assert.deepEqual(first.custom, remote.custom);
  assert.equal(first.sync.revision, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(dataFile, 'utf8')).assets, remote.assets);
  assert.deepEqual((await repository.readData()).assets, remote.assets);
});

test('invalid writes and imports preserve the last valid repository snapshot', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-validation-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const repository = createRepository({ dataFile, drive: { isEnabled: () => false } });
  await repository.readData();
  const before = await fs.readFile(dataFile, 'utf8');
  for (const write of [repository.saveData, repository.writeLocalData]) {
    await assert.rejects(write({ assets: [], payments: {} }), /payments/);
    await assert.rejects(write({ assets: [], wallet: { expenses: 'invalid' } }), /expenses/);
    await assert.rejects(write({ assets: [{ currentPrice: Infinity }] }), /finite/);
    assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  }
});

test('first-run reads and mutations initialize JSON once without losing an asset', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-first-run-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const repository = createRepository({ dataFile, drive: { isEnabled: () => false } });
  const service = createService(repository, {});
  const creation = service.createAsset({
    name: 'First holding', type: 'stock', quantity: 1, purchasePrice: 100,
    currentPrice: 100, purchaseDate: '2026-01-01', currency: 'USD',
  });
  const results = await Promise.allSettled([
    ...Array.from({ length: 25 }, () => repository.readData()), creation,
  ]);
  assert.ok(results.every((result) => result.status === 'fulfilled'),
    JSON.stringify(results.filter((result) => result.status === 'rejected').map((result) => result.reason.message)));
  const saved = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  assert.equal(saved.assets.length, 1);
  assert.equal(saved.transactions.length, 1);
  assert.equal(saved.assets[0].name, 'First holding');
});
