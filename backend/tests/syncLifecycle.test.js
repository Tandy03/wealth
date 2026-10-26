const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRepository } = require('../data/repository');
const { createStorage } = require('../services/googleDrive/storage');
const { normalizeState, createEmptyState } = require('../../shared/state-model');
const { digest } = require('../data/journal');
const { createHash } = require('node:crypto');
const { signature } = require('../../shared/sync-model');
const fixture = () => normalizeState({ ...createEmptyState(), sync: { revision: 1, deviceId: 'test' }, assets: [{ id: 'a', type: 'stock', quantity: 1, purchasePrice: 100, purchaseDate: '2026-01-01' }] });
async function storage(t, initial = fixture()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-sync-lifecycle-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let remote = structuredClone(initial), version = 1;
  const hooks = {}, backups = [];
  const metadata = () => ({ id: 'main', ownedByMe: true, version: String(version), md5Checksum: createHash('md5').update(JSON.stringify(remote, null, 2)).digest('hex'), appProperties: { finoRevision: String(remote?.sync?.revision || 0) } });
  const response = data => ({ data, headers: { etag: 'version-' + version } });
  const files = {
    async get(params) {
      if (hooks.auth) throw Object.assign(new Error('Bearer secret-token'), { code: 401 });
      if (params.fileId === 'folder') return response({ id: 'folder', ownedByMe: true, permissions: hooks.shared ? [{ type: 'anyone', role: 'reader' }] : [{ type: 'user', role: 'owner' }] });
      if (!remote) throw Object.assign(new Error('deleted'), { code: 404 });
      if (params.alt === 'media') return response(JSON.stringify(remote));
      return response(metadata());
    },
    async list(params) {
      if (params.q.includes('finoBackup')) return response({ files: hooks.retention || [] });
      if (params.q.includes('folder')) return response({ files: [{ id: 'folder', ownedByMe: true }] });
      return response({ files: remote ? [metadata()] : [] });
    },
    async update(params, options) {
      if (hooks.upload) await hooks.upload();
      if (options.headers['If-Match'] && options.headers['If-Match'] !== 'version-' + version) throw Object.assign(new Error('changed'), { code: 412 });
      let text = ''; for await (const chunk of params.media.body) text += chunk;
      if (!hooks.dropUpload) { remote = JSON.parse(text); version++; }
      return response(metadata());
    },
    async create(params) {
      if (params.requestBody.mimeType === 'application/vnd.google-apps.folder') return response({ id: 'folder' });
      let text = ''; for await (const chunk of params.media.body) text += chunk;
      if (params.requestBody.appProperties?.finoBackup) { backups.push({ ...params.requestBody, snapshot: JSON.parse(text) }); return response({ id: 'backup-' + backups.length }); }
      remote = JSON.parse(text); version++; return response(metadata());
    },
    async copy(params) { backups.push({ ...params.requestBody, snapshot: structuredClone(remote) }); return response({ id: 'backup-' + backups.length }); },
    async delete(params) { (hooks.deleted ||= []).push(params.fileId); },
  };
  const drive = createStorage({ stateFile: path.join(dir, 'drive-state.json'), enabled: () => true, getClient: async () => ({ files }), timeoutMs: 1000 });
  const dataFile = path.join(dir, 'data.json'); await fs.writeFile(dataFile, JSON.stringify(initial));
  const repository = createRepository({ dataFile, drive }); await repository.readData(); await repository.waitForRemoteInitialization(); await drive.waitForUploads();
  return { dir, dataFile, drive, repository, hooks, backups, remote: () => structuredClone(remote), changeRemote(value) { remote = value; version++; } };
}
test('local success remains pending until Drive read-back confirms the exact snapshot', async t => {
  const h = await storage(t);
  let release, started;
  const began = new Promise(resolve => started = resolve);
  h.hooks.upload = () => { started(); return new Promise(resolve => release = resolve); };
  const data = await h.repository.readData(); data.calendarNotes.push({ id: 'n', title: 'Persisted', date: '2026-01-01' });
  const outcome = await h.repository.saveData(data); await began;
  assert.equal(outcome.savedLocally, true); assert.equal(outcome.savedRemotely, false);
  assert.equal(h.repository.getSyncStatus().state, 'sync-pending');
  release(); await h.drive.waitForUploads();
  assert.equal(h.repository.getSyncStatus().state, 'sync-confirmed');
  assert.deepEqual(h.remote().calendarNotes, data.calendarNotes);
});

test('reviewed sync resolution rejects a cloud change before upload and preserves the new cloud document', async t => {
  const h = await storage(t), service = require('../services/syncService').createService(h.repository);
  const preview = await service.getConflictPreview();
  const changed = h.remote(); changed.calendarNotes.push({id:'cloud-change',date:'2026-10-01'});h.changeRemote(changed);
  await assert.rejects(service.syncDrive('upload',{previewToken:preview.token}),error=>error.code==='SYNC_PREVIEW_STALE');
  assert.deepEqual(h.remote(),changed);assert.equal(h.backups.length,0);
  const current = await service.getConflictPreview();
  await service.syncDrive('upload',{previewToken:current.token});
  assert.equal(h.remote().calendarNotes.length,0);assert.equal(h.backups.length,1);assert.equal(h.backups[0].snapshot.calendarNotes[0].id,'cloud-change');
});
test('an older upload confirmation cannot confirm newer local changes', async t => {
  const h = await storage(t);
  let release, started; const began = new Promise(resolve => started = resolve);
  h.hooks.upload = () => { started(); return new Promise(resolve => release = resolve); };
  const first = await h.repository.readData(); first.calendarNotes.push({ id: 'first' });
  await h.repository.saveData(first); await began;
  const newer = await h.repository.readData(); newer.calendarNotes.push({ id: 'second' });
  // Commit the new version without starting a second background operation.
  newer.sync.revision++; await h.repository.writeLocalData(newer);
  release(); await h.drive.waitForUploads();
  assert.equal(h.repository.getSyncStatus().state, 'sync-pending');
  assert.equal(h.repository.getSyncStatus().savedRemotely, false);
});
test('HTTP success with a dropped upload never marks the data confirmed', async t => {
  const h = await storage(t); h.hooks.dropUpload = true;
  const data = await h.repository.readData(); data.calendarNotes.push({ id: 'unsent' });
  await h.repository.saveData(data); await h.drive.waitForUploads();
  assert.equal(h.repository.getSyncStatus().state, 'conflict');
  assert.equal(h.repository.getSyncStatus().savedRemotely, false);
  assert.equal((await h.repository.readData()).calendarNotes.length, 1);
});
test('startup preserves unsent local changes and both sides of a conflict', async t => {
  const h = await storage(t);
  const local = await h.repository.readData(); local.calendarNotes.push({ id: 'local' }); local.sync.revision++;
  await h.repository.writeLocalData(local);
  const remote = h.remote(); remote.calendarNotes.push({ id: 'remote' }); h.changeRemote(remote);
  const restarted = createRepository({ dataFile: h.dataFile, drive: h.drive });
  const recovered = await restarted.readData();
  await h.drive.waitForUploads();
  assert.equal(recovered.calendarNotes[0].id, 'local'); assert.equal(h.remote().calendarNotes[0].id, 'remote');
  assert.equal(restarted.getSyncStatus().state, 'conflict');
  assert.ok((await restarted.journalHistory()).some(entry => signature(entry.snapshot) === signature(local)));
});
test('corrupted JSON and a torn journal tail recover the last committed financial version', async t => {
  const h = await storage(t);
  const data = await h.repository.readData(); data.transactions.push({ id: 'second-buy', assetId: 'a', type: 'BUY', quantity: 2, amount: 300, date: '2026-02-01' });
  await h.repository.writeLocalData(data);
  await fs.writeFile(h.dataFile, '{partial'); await fs.appendFile(h.dataFile + '.journal.ndjson', '{"kind":');
  const restarted = createRepository({ dataFile: h.dataFile, drive: { isEnabled: () => false } });
  assert.deepEqual((await restarted.readData()).transactions, data.transactions);
  assert.equal(digest(JSON.parse(await fs.readFile(h.dataFile, 'utf8'))), digest(data));
});
test('auth failure is explicit and never leaks the provider message', async t => {
  const h = await storage(t); h.hooks.auth = true;
  const data = await h.repository.readData(); data.calendarNotes.push({ id: 'pending' });
  await h.repository.saveData(data); await h.drive.waitForUploads();
  const status = h.repository.getSyncStatus(); assert.equal(status.state, 'auth-required');
  assert.equal(status.savedLocally, true); assert.equal(status.savedRemotely, false);
  assert.ok(!JSON.stringify(status).includes('secret-token'));
});
test('manual backup does not confirm pending edits and shared backup folders are rejected', async t => {
  const h = await storage(t);
  const data = await h.repository.readData(); data.calendarNotes.push({ id: 'local' }); await h.repository.writeLocalData(data);
  await h.drive.createManualBackup(data);
  assert.equal(h.repository.getSyncStatus().state, 'sync-pending'); assert.equal(h.backups[0].appProperties.kind, 'manual');
  h.hooks.shared = true;
  await assert.rejects(h.drive.createManualBackup(data), /private/);
  assert.equal(h.backups.length, 1);
});
test('backup retention only removes owned, tagged backups of the selected kind', async t => {
  const h = await storage(t);
  h.hooks.retention = Array.from({ length: 12 }, (_, index) => ({ id: String(index), ownedByMe: true, createdTime: new Date().toISOString(), appProperties: { finoBackup: 'true', kind: 'automatic' } }));
  h.hooks.retention.push({ id: 'unrelated', ownedByMe: true }, { id: 'manual', ownedByMe: true, appProperties: { finoBackup: 'true', kind: 'manual' } });
  await h.drive.createAutomaticBackup(await h.repository.readData());
  assert.deepEqual(h.hooks.deleted, ['10', '11']);
});

test('a failed journal commit rolls back a renamed snapshot and keeps the caller revision', async t => {
  const h = await storage(t), before = await h.repository.readData(), previousRevision = before.sync.revision;
  const open = fs.open;
  const mocked = t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] !== h.dataFile + '.journal.ndjson') return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'writeFile') return async value => { if (JSON.parse(value).kind === 'commit') throw Object.assign(new Error('disk failure'), { code: 'EIO' }); return target.writeFile(value); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  const candidate = structuredClone(before); candidate.calendarNotes.push({ id: 'rejected' });
  await assert.rejects(h.repository.saveData(candidate), { code: 'STORAGE_FAILURE' });
  assert.equal(candidate.sync.revision, previousRevision); assert.deepEqual(await h.repository.readLocalData(), before);
  mocked.mock.restore();
  const restarted = createRepository({ dataFile: h.dataFile, drive: { isEnabled: () => false } });
  assert.deepEqual(await restarted.readData(), before);
});

test('generic posted trades maintain historical quantity, remaining cost and immutable sales', async t => {
  const h = await storage(t, normalizeState({ ...fixture(), assets: [{ ...fixture().assets[0], quantity: 10 }], transactions: [{ id: 'initial', assetId: 'a', type: 'BUY', quantity: 10, amount: 1000, date: '2026-01-01' }] }));
  const service = require('../domain/transactionsService').createService(h.repository);
  await service.createTransaction({ assetId: 'a', type: 'SELL', quantity: 5, amount: 600, date: '2026-02-01' });
  const sale = (await h.repository.readData()).sales[0];
  await service.createTransaction({ assetId: 'a', type: 'BUY', quantity: 5, amount: 1000, date: '2026-03-01' });
  const after = await h.repository.readData();
  assert.equal(after.assets[0].quantity, 15); assert.equal(after.assets[0].remainingQuantity, 10); assert.equal(after.assets[0].remainingCostBasis, 1500);
  assert.deepEqual(after.sales[0], sale); assert.equal(after.transactions.at(-1).status, 'completed');
  await h.drive.waitForUploads();
});

test('explicit download fences background uploads so an abandoned queued version cannot reappear', async t => {
  const h = await storage(t);
  let release, started; const began = new Promise(resolve => started = resolve);
  h.hooks.upload = () => { h.hooks.upload = null; started(); return new Promise(resolve => release = resolve); };
  const first = await h.repository.readData(); first.calendarNotes.push({ id: 'first' });
  await h.repository.saveData(first); await began;
  const second = await h.repository.readData(); second.calendarNotes.push({ id: 'second' }); await h.repository.saveData(second);
  const download = require('../services/syncService').createService(h.repository).syncDrive('download');
  release(); const result = await download; await h.drive.waitForUploads();
  assert.equal(result.savedRemotely, true);
  assert.deepEqual((await h.repository.readData()).calendarNotes.map(note => note.id), ['first']);
  assert.deepEqual(h.remote().calendarNotes.map(note => note.id), ['first']);
  assert.ok(h.backups.some(backup => backup.snapshot?.calendarNotes?.some(note => note.id === 'second')));
});

test('sync success reports a new backup only for the operation that created it', async t => {
  const h = await storage(t), service = require('../services/syncService').createService(h.repository);
  const data = await h.repository.readData(); data.calendarNotes.push({ id: 'changed' }); await h.repository.writeLocalData(data);
  const uploaded = await service.syncDrive('upload'); assert.equal(uploaded.savedRemotely, true); assert.equal(uploaded.backupSaved, true);
  const identical = await service.syncDrive('sync'); assert.equal(identical.savedRemotely, true); assert.equal(identical.backupSaved, false);
});
