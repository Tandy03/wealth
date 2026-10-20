const test = require('node:test');
const assert = require('node:assert/strict');
const { comparison, comparisonToken } = require('../../shared/sync-model');
const { harness, fixture, clone } = require('./helpers/nativeHarness');
const { createService } = require('../services/syncService');
const { validateSyncOptions } = require('../../shared/validation').createDefault();
test('sync summaries compare facts, plans and metadata without returning financial records', async () => {
  const local = fixture(), remote = clone(local);
  remote.sync = { revision: 8, updatedAt: '2026-10-20T09:00:00Z', deviceId: 'other-device' };
  remote.assets[0].name = 'Changed'; remote.wallet.expenses.push({ id: 'new', amount: 123.45, date: '2026-01-01', category: 'Health' });
  remote.wallet.months['2026-01'] = { plans: { Health: 100 } };
  const result = await comparison(local, remote, 'owner');
  assert.equal(result.local.counts.assets, 1); assert.equal(result.remote.deviceId, 'other-device');
  assert.deepEqual(result.differences.assets, { localOnly: 0, remoteOnly: 0, changed: 1 });
  assert.equal(result.differences.expenses.remoteOnly, 1); assert.equal(result.plansDiffer, true);
  assert.ok(!JSON.stringify(result).includes('123.45')); assert.ok(!JSON.stringify(result).includes('Bond'));
  assert.notEqual(result.token, await comparisonToken(local, remote, 'another-owner'));
  assert.equal(result.token, await comparisonToken(JSON.parse(JSON.stringify(local)), remote, 'owner'));
  for (const options of [{previewToken:'bad'},{previewToken:1},{other:true}]) assert.throws(() => validateSyncOptions('upload', options));
  assert.throws(() => validateSyncOptions('sync', {previewToken:result.token}));
});
test('native comparison is read-only; stale choices preserve both documents and valid download keeps a recovery copy', async () => {
  const h = harness(); await h.api.getData({sync:false}); const before = h.local();
  const preview = await h.api.getSyncConflictPreview(); assert.deepEqual(h.local(), before); assert.equal(h.uploads.length, 0);
  const remote = h.remote(); remote.wallet.expenses.push({id:'remote-expense',amount:10,date:'2026-01-01',category:'Health'}); h.changeRemote(remote);
  await assert.rejects(h.api.syncGoogleDrive('download',{previewToken:preview.token}), error => error.code === 'SYNC_PREVIEW_STALE' && error.status === 409);
  assert.deepEqual(h.local(), before); assert.deepEqual(h.remote(), remote); assert.equal(h.backups.length, 0);
  const current = await h.api.getSyncConflictPreview(); await h.api.syncGoogleDrive('download',{previewToken:current.token});
  assert.equal(h.local().wallet.expenses[0].id,'remote-expense'); assert.ok(h.backups.some(copy => JSON.stringify(copy) === JSON.stringify(before)));
});
test('native comparison tokens cannot cross accounts and local edits invalidate a reviewed choice', async () => {
  const h = harness(); await h.api.getData({sync:false}); const preview = await h.api.getSyncConflictPreview();
  h.offline(true); await h.api.createCalendarNote({text:'local-only',assetId:'bond',date:'2026-10-01'}); await h.drain(); h.offline(false);
  const local = h.local(); await assert.rejects(h.api.syncGoogleDrive('upload',{previewToken:preview.token}), error => error.code === 'SYNC_PREVIEW_STALE');
  assert.deepEqual(h.local(),local); assert.equal(h.uploads.length,0);
  const wrongAccount = await comparisonToken(local,h.remote(),'another@example.com');
  await assert.rejects(h.api.syncGoogleDrive('upload',{previewToken:wrongAccount}), error => error.code === 'SYNC_PREVIEW_STALE');
});
test('backend compares before resolving and rejects stale local or remote snapshots without any financial write', async () => {
  let local = fixture(), remote = clone(local), writes = 0, backups = 0;
  const drive = {getStatus:()=>({fileId:'main'}),downloadData:async()=>clone(remote),createAutomaticBackup:async()=>{backups++;},
    uploadData:async value=>{writes++;remote=clone(value);},confirmDownload:async()=>{},recordFailure:()=>{}};
  const service=createService({drive,initializeStorage:async()=>{},readLocalData:async()=>clone(local),writeLocalData:async value=>{writes++;local=clone(value);},runMutation:action=>action()});
  const initial = await service.getConflictPreview(); remote.calendarNotes.push({id:'r',date:'2026-01-01'});
  await assert.rejects(service.syncDrive('upload',{previewToken:initial.token}),e=>e.code==='SYNC_PREVIEW_STALE');
  assert.equal(writes,0);assert.equal(backups,0);
  const updated = await service.getConflictPreview();local.calendarNotes.push({id:'l',date:'2026-01-02'});
  await assert.rejects(service.syncDrive('download',{previewToken:updated.token}),e=>e.code==='SYNC_PREVIEW_STALE');assert.equal(writes,0);
  const current = await service.getConflictPreview();await service.syncDrive('download',{previewToken:current.token});assert.equal(writes,1);assert.equal(backups,1);assert.equal(local.calendarNotes[0].id,'r');
});
test('native writes identify the installation consistently across restart', async () => {
  const h=harness();await h.api.getData({sync:false});h.offline(true);
  await h.api.createCalendarNote({text:'first',assetId:'bond',date:'2026-10-01'});await h.drain();const id=h.local().sync.deviceId;assert.match(id,/^android-/);
  const restarted=harness({storage:h.storage});await restarted.api.getData({sync:false});restarted.offline(true);
  await restarted.api.createCalendarNote({text:'second',assetId:'bond',date:'2026-10-02'});await restarted.drain();assert.equal(restarted.local().sync.deviceId,id);
});
