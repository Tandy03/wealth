const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const defaultDrive = require('../services/googleDrive/storage');
const { createEmptyState, normalizeState, validateState } = require('../../frontend/js/state-model');
const { describe } = require('../../frontend/js/sync-model');
const { StorageError, ValidationError } = require('../../frontend/js/errors');
const { createJournal, digest } = require('./journal');
const { atomicWrite } = require('./atomicFile');
const { logEvent } = require('../utils/observability');
function createRepository({ dataFile = path.join(__dirname, 'data.json'), drive = defaultDrive } = {}) {
  const journal = createJournal(dataFile + '.journal.ndjson');
  let initialization = null, mutationQueue = Promise.resolve(), current = null;
  function runMutation(operation) {
    const result = mutationQueue.then(operation, operation); mutationQueue = result.catch(() => {}); return result;
  }
  async function acknowledgeRemote(snapshot) {
    try { await journal.acknowledge(snapshot); }
    catch (cause) { throw new StorageError({ message: 'Remote upload succeeded, but its confirmation could not be saved locally. Local data is preserved.', cause }); }
  }
  drive.subscribeConfirmation?.(acknowledgeRemote);
  function getSyncStatus() {
    const remote = drive.getStatus?.() || {};
    const confirmed = current ? journal.confirmed(current) : false;
    return describe({ ...remote, savedLocally: Boolean(current), localRevision: current?.sync?.revision || 0,
      pendingUpload: drive.isEnabled() && Boolean(current) && !confirmed,
      remoteConfirmed: confirmed, backupSaved: Boolean(remote.backupSaved) });
  }
  async function writeLocalData(data) {
    let snapshot;
    try { snapshot = normalizeState(data); } catch (cause) { throw new ValidationError({ message: cause.message, cause }); }
    const previous = current;
    try {
      await journal.commit(snapshot, () => atomicWrite(dataFile, JSON.stringify(snapshot, null, 2)),
        previous ? () => atomicWrite(dataFile, JSON.stringify(previous, null, 2)) : null);
      current = snapshot;
      drive.markLocalSaved?.(snapshot);
      return { savedLocally: true, savedRemotely: journal.confirmed(snapshot), backupSaved: false };
    } catch (cause) { logEvent('storage.write_failed', { code: cause.code || 'STORAGE_FAILURE' }); throw new StorageError({ cause }); }
  }
  async function saveData(data) {
    try { validateState(data); } catch (cause) { throw new ValidationError({ message: cause.message, cause }); }
    const snapshot = normalizeState(data);
    snapshot.sync = { ...snapshot.sync, revision: Math.max(Number(current?.sync?.revision || 0), Number(data.sync?.revision || 0)) + 1,
      updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
    const result = await writeLocalData(snapshot);
    data.sync = snapshot.sync;
    if (drive.isEnabled()) {
      try { drive.queueUpload(snapshot); }
      catch (error) { logEvent('sync.queue_failed', { code: error.code || 'REMOTE_UNAVAILABLE' }); }
    }
    return { ...result, state: getSyncStatus().state };
  }
  async function readLocalData() {
    try { return normalizeState(JSON.parse(await fs.readFile(dataFile, 'utf8'))); }
    catch (cause) { logEvent('storage.read_failed', { code: cause.code || 'INVALID_STORED_DATA' }); throw new StorageError({ cause }); }
  }
  async function initializeStorage() {
    if (initialization) return initialization;
    initialization = (async () => {
      await journal.load();
      let local = null;
      try { local = normalizeState(JSON.parse(await fs.readFile(dataFile, 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT' && !journal.last()) throw error; }
      const last = journal.last();
      if (last && (!local || digest(local) !== last.checksum)) {
        local = normalizeState(last.snapshot);
        await atomicWrite(dataFile, JSON.stringify(local, null, 2));
        logEvent('storage.recovered', { revision: local.sync?.revision || 0 });
      }
      if (local) {
        current = local;
        if (!last) await writeLocalData(local);
      } else {
        await saveData(createEmptyState()); local = current;
      }
      if (!drive.isEnabled()) return;
      try {
        const initialized = await drive.initialize(local, { pending: !journal.confirmed(local), hasLocalHistory: Boolean(last || local.assets.length || local.transactions.length || local.wallet.expenses.length) });
        let imported = normalizeState(initialized.data);
        const needsMetadata = !imported.sync;
        if (needsMetadata) imported.sync = { revision: 1, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
        if (digest(imported) !== digest(current)) await writeLocalData(imported);
        if (initialized.source === 'google-drive') await drive.confirmDownload?.(needsMetadata ? initialized.data : imported);
        if (needsMetadata) {
          try { await drive.uploadData(imported); if (!drive.subscribeConfirmation) await acknowledgeRemote(imported); }
          catch (error) { logEvent('sync.initial_upload_failed', { code: error.code || 'REMOTE_UNAVAILABLE' }); }
        }
      } catch (error) { logEvent('sync.initialization_pending', { code: error.code || 'REMOTE_UNAVAILABLE' }); }
    })().catch(cause => { initialization = null; throw cause instanceof ValidationError ? cause : new StorageError({ cause }); });
    return initialization;
  }
  async function readData() { await initializeStorage(); return readLocalData(); }
  return { readData, readLocalData, saveData, writeData: saveData, writeLocalData, initializeStorage, runMutation,
    acknowledgeRemote, getSyncStatus, journalHistory: async () => { await journal.load(); return journal.history(); }, drive };
}
module.exports = { createRepository };
