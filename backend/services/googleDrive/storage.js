const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash, randomUUID } = require('node:crypto');
const { google } = require('googleapis');
const { createAuthorizedClient, disconnect } = require('./auth');
const { atomicWrite } = require('../../data/atomicFile');
const { normalizeState } = require('../../../frontend/js/state-model');
const { describe, signature } = require('../../../frontend/js/sync-model');
const { ConflictError, AuthRequiredError, ValidationError, RemoteUnavailableError, StorageError, syncError } = require('../../../frontend/js/errors');
const { logEvent } = require('../../utils/observability');
const serializeData = data => JSON.stringify(data, null, 2);
const dataChecksum = data => createHash('md5').update(serializeData(data)).digest('hex');
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ValidationError({ message: 'Google Drive file must contain a JSON object.' });
  if (!Array.isArray(data.assets)) throw new ValidationError({ message: 'Google Drive data has an invalid assets collection.' });
  try { return normalizeState(data); } catch (cause) { throw new ValidationError({ message: 'Google Drive data is invalid: ' + cause.message, cause }); }
}
function hasConflict({ expectedChecksum, actualChecksum, knownRevision, remoteRevision }) {
  if (expectedChecksum && actualChecksum && expectedChecksum !== actualChecksum) return true;
  return knownRevision != null && remoteRevision != null && Number.isFinite(Number(knownRevision)) && Number.isFinite(Number(remoteRevision)) && Number(remoteRevision) > Number(knownRevision);
}
async function retryOperation(operation, attempts = 3, delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  let last;
  for (let attempt = 0; attempt < Math.min(3, Math.max(1, attempts)); attempt++) {
    try { return await operation(); } catch (error) {
      last = error;
      const status = Number(error.response?.status || error.status || error.code);
      if (['conflict', 'auth_required', 'validation', 'storage_failure'].includes(require('../../../frontend/js/errors').classify(error)) ||
          (status >= 400 && status < 500 && ![408, 429].includes(status)) || attempt + 1 >= attempts || attempt === 2) break;
      await delay(250 * 2 ** attempt);
    }
  }
  throw last;
}
function createStorage({ stateFile = path.resolve(__dirname, '../../../', process.env.GOOGLE_DRIVE_STATE_PATH || 'backend/config/google-drive-state.json'),
  enabled = () => process.env.GOOGLE_DRIVE_SYNC_ENABLED === 'true', getClient = async () => google.drive({ version: 'v3', auth: await createAuthorizedClient() }),
  disconnectClient = disconnect, timeoutMs = 10000, automaticRetention = Number(process.env.GOOGLE_DRIVE_BACKUP_RETENTION) || 10,
  manualRetention = Number(process.env.GOOGLE_DRIVE_MANUAL_BACKUP_RETENTION) || 30 } = {}) {
  const fileName = process.env.GOOGLE_DRIVE_FILE_NAME || 'fino-data.json';
  const folderName = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_NAME || 'fino-backups';
  const fields = 'id,name,version,modifiedTime,md5Checksum,appProperties,trashed,ownedByMe';
  const observers = new Set();
  let remote = { fileId: process.env.GOOGLE_DRIVE_FILE_ID || null, md5Checksum: null, dataRevision: null };
  let loaded = false, client = null, folder = null, candidate = null, uploadSerial = Promise.resolve(), queued = null, runner = null, localSignature = null, paused = 0;
  let status = { connected: false, syncing: false, pendingUpload: false, conflict: false, authorizationRequired: false, remoteConfirmed: false, savedLocally: false,
    backupSaved: false, lastSyncAt: null, lastDirection: null, error: null, errorCode: null, confirmedRevision: null };
  async function call(method, parameters, options = {}) {
    const controller = new AbortController(); let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RemoteUnavailableError({ code: 'EXTERNAL_API_TIMEOUT', status: 504 })); }, timeoutMs); });
    try { return await Promise.race([deadline, method(parameters, { ...options, timeout: timeoutMs, retry: false, signal: controller.signal })]); }
    catch (error) {
      if (Number(error.code || error.response?.status) === 401 || error.response?.data?.error === 'invalid_grant') throw new AuthRequiredError({ cause: error });
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function drive() {
    if (!enabled()) throw new RemoteUnavailableError({ message: 'Google Drive synchronization is disabled.' });
    if (!client) client = Promise.resolve().then(getClient).catch(error => { client = null; throw error; });
    return client;
  }
  async function load() {
    if (loaded) return;
    try { const saved = JSON.parse(await fs.readFile(stateFile, 'utf8')); if (typeof saved.fileId === 'string') remote = { ...remote, ...saved }; }
    catch (error) { if (error.code !== 'ENOENT') logEvent('sync.metadata_unavailable', { code: 'STORAGE_FAILURE' }); }
    loaded = true;
  }
  async function persist(metadata, snapshot) {
    const next = { fileId: metadata.id, md5Checksum: metadata.md5Checksum || null, version: metadata.version || null, dataRevision: snapshot.sync?.revision ?? null };
    try { await atomicWrite(stateFile, JSON.stringify(next)); }
    catch (cause) { throw new StorageError({ message: 'Sync confirmation could not be saved locally. Local financial data is preserved.', cause }); }
    remote = next;
  }
  function fail(error) {
    const typed = syncError(error);
    status = { ...status, connected: typed.category === 'conflict', pendingUpload: status.savedLocally && !status.remoteConfirmed,
      conflict: typed.category === 'conflict', authorizationRequired: typed.category === 'auth_required', error: typed.message, errorCode: typed.code };
    return typed;
  }
  async function locate(d) {
    await load();
    if (remote.fileId) {
      try {
        const response = await call(d.files.get.bind(d.files), { fileId: remote.fileId, fields });
        if (!response.data.trashed) return { ...response.data, etag: response.headers?.get?.('etag') || response.headers?.etag };
        return null;
      } catch (error) { if (Number(error.code || error.response?.status) !== 404) throw error; return null; }
    }
    const escaped = fileName.replace(/'/g, "\\'");
    const response = await call(d.files.list.bind(d.files), { q: `name = '${escaped}' and trashed = false and 'me' in owners`, spaces: 'drive', pageSize: 10, orderBy: 'modifiedTime desc', fields: `files(${fields})` });
    if ((response.data.files || []).length > 1) throw new ConflictError({ message: 'Multiple portfolio files were found. Select GOOGLE_DRIVE_FILE_ID explicitly.' });
    const found = response.data.files?.[0];
    if (!found) return null;
    const response2 = await call(d.files.get.bind(d.files), { fileId: found.id, fields });
    return { ...response2.data, etag: response2.headers?.get?.('etag') || response2.headers?.etag };
  }
  async function readRemote() {
    const d = await drive(), metadata = await locate(d);
    if (!metadata) return null;
    const response = await call(d.files.get.bind(d.files), { fileId: metadata.id, alt: 'media' }, { responseType: 'text' });
    let data;
    try { data = validateData(typeof response.data === 'string' ? JSON.parse(response.data) : response.data); }
    catch (cause) { throw cause instanceof ValidationError ? cause : new ValidationError({ message: 'Google Drive contains invalid JSON.', cause }); }
    const checked = await call(d.files.get.bind(d.files), { fileId: metadata.id, fields });
    if (metadata.version && checked.data.version !== metadata.version || metadata.md5Checksum && checked.data.md5Checksum !== metadata.md5Checksum) throw new ConflictError();
    return { metadata, data };
  }
  async function confirm(snapshot, metadata, direction) {
    await persist(metadata, snapshot);
    for (const observer of observers) await observer(snapshot);
    const same = !localSignature || localSignature === signature(snapshot);
    status = { ...status, connected: true, remoteConfirmed: same, pendingUpload: !same, conflict: false, authorizationRequired: false,
      confirmedRevision: snapshot.sync?.revision || 0, lastSyncAt: new Date().toISOString(), lastDirection: direction, error: null, errorCode: null };
  }
  async function privateFolder(d, id) {
    const response = await call(d.files.get.bind(d.files), { fileId: id, fields: 'id,ownedByMe,permissions(type,role)' });
    if (response.data.ownedByMe !== true || !Array.isArray(response.data.permissions) || response.data.permissions.some(permission => permission.type !== 'user' || permission.role !== 'owner')) throw new AuthRequiredError({ message: 'Backup folder must be private to the authorized owner.' });
    return id;
  }
  async function getFolder(d) {
    if (folder) return privateFolder(d, folder);
    const escaped = folderName.replace(/'/g, "\\'");
    const found = await call(d.files.list.bind(d.files), { q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'me' in owners`, fields: 'files(id,ownedByMe)', pageSize: 10 });
    if (found.data.files?.length > 1) throw new ConflictError({ message: 'Multiple backup folders were found.' });
    if (found.data.files?.[0]) { folder = found.data.files[0].id; return privateFolder(d, folder); }
    const created = await call(d.files.create.bind(d.files), { requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' });
    folder = created.data.id; return privateFolder(d, folder);
  }
  async function trim(d, folderId, kind) {
    const retention = Math.min(100, Math.max(1, kind === 'manual' ? manualRetention : automaticRetention));
    let pageToken, collected = [];
    do {
      const response = await call(d.files.list.bind(d.files), { q: `'${folderId}' in parents and trashed = false and 'me' in owners and appProperties has { key='finoBackup' and value='true' } and appProperties has { key='kind' and value='${kind}' }`,
        orderBy: 'createdTime desc', pageSize: 100, pageToken, fields: 'nextPageToken,files(id,createdTime,appProperties,ownedByMe)' });
      collected.push(...(response.data.files || [])); pageToken = response.data.nextPageToken;
    } while (pageToken && collected.length < 1000);
    const maxAge = (kind === 'manual' ? 90 : 30) * 86400000;
    for (const [index, file] of collected.entries()) {
      // Never remove legacy, shared, or unrelated files even if a provider ignores the query.
      if (file.ownedByMe !== true || file.appProperties?.finoBackup !== 'true' || file.appProperties?.kind !== kind) continue;
      if (index >= retention || Date.now() - Date.parse(file.createdTime) > maxAge) await call(d.files.delete.bind(d.files), { fileId: file.id });
    }
  }
  async function backup(snapshot, kind = 'manual', remoteFile = null) {
    const d = await drive(), folderId = await getFolder(d);
    const requestBody = { name: `fino-data-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`, parents: [folderId],
      description: `fino ${kind} backup`, appProperties: { finoBackup: 'true', kind } };
    const response = remoteFile
      ? await call(d.files.copy.bind(d.files), { fileId: remoteFile, requestBody, fields: 'id,name,createdTime' })
      : await call(d.files.create.bind(d.files), { requestBody: { ...requestBody, mimeType: 'application/json' }, media: { mimeType: 'application/json', body: Readable.from([serializeData(validateData(snapshot))]) }, fields: 'id,name,createdTime' });
    if (!response.data.id) throw new RemoteUnavailableError();
    status.backupSaved = true; status.lastBackupAt = new Date().toISOString(); status.lastBackupKind = kind; status.lastBackupId = response.data.id;
    status.connected = true; status.authorizationRequired = false;
    try { await trim(d, folderId, kind); } catch (error) { logEvent('sync.backup_retention_pending', { code: error.code || 'REMOTE_UNAVAILABLE' }); }
    return { ...response.data, savedLocally: status.savedLocally, savedRemotely: false, backupSaved: true, kind };
  }
  async function uploadOnce(input, { force = false } = {}) {
    const snapshot = validateData(input); status.syncing = true;
    try {
      const d = await drive(); await load(); const expected = { ...remote }; let metadata = await locate(d);
      if (!metadata && expected.fileId && !force) throw new ConflictError({ message: 'The remote portfolio was deleted. Choose Upload explicitly to restore it.' });
      if (metadata) {
        if (metadata.ownedByMe !== true) throw new AuthRequiredError({ message: 'The portfolio file must belong to the authorized account.' });
        if (!force && (hasConflict({ expectedChecksum: expected.md5Checksum, actualChecksum: metadata.md5Checksum, knownRevision: expected.dataRevision, remoteRevision: metadata.appProperties?.finoRevision }) || !expected.md5Checksum && metadata.md5Checksum !== dataChecksum(snapshot))) throw new ConflictError();
        if (metadata.md5Checksum === dataChecksum(snapshot)) { await confirm(snapshot, metadata, 'upload'); return; }
        await backup(null, 'automatic', metadata.id);
        const checked = await locate(d);
        if (!checked || checked.md5Checksum !== metadata.md5Checksum || checked.version !== metadata.version) throw new ConflictError();
        const response = await call(d.files.update.bind(d.files), { fileId: metadata.id, requestBody: { appProperties: { finoRevision: String(snapshot.sync?.revision || 0), finoApp: 'true' } },
          media: { mimeType: 'application/json', body: Readable.from([serializeData(snapshot)]) }, fields }, { headers: metadata.etag ? { 'If-Match': metadata.etag } : {} });
        metadata = response.data;
      } else {
        const response = await call(d.files.create.bind(d.files), { requestBody: { name: fileName, mimeType: 'application/json', appProperties: { finoRevision: String(snapshot.sync?.revision || 0), finoApp: 'true' } },
          media: { mimeType: 'application/json', body: Readable.from([serializeData(snapshot)]) }, fields }); metadata = response.data;
      }
      if (!metadata?.id) throw new RemoteUnavailableError();
      // A successful HTTP response alone is insufficient: read back the uploaded document.
      const verification = await call(d.files.get.bind(d.files), { fileId: metadata.id, alt: 'media' }, { responseType: 'text' });
      const actual = validateData(typeof verification.data === 'string' ? JSON.parse(verification.data) : verification.data);
      if (signature(actual) !== signature(snapshot)) throw new ConflictError({ message: 'Drive did not retain the uploaded version. Local changes remain pending.' });
      await confirm(snapshot, metadata, 'upload');
    } catch (error) { throw fail(error); } finally { status.syncing = false; }
  }
  function uploadData(data, attempts = 3, options = {}) {
    const snapshot = structuredClone(data);
    const operation = uploadSerial.then(() => retryOperation(() => uploadOnce(snapshot, options), attempts)); uploadSerial = operation.catch(() => {}); return operation;
  }
  function markLocalSaved(snapshot) {
    localSignature = signature(snapshot); status.savedLocally = true; status.remoteConfirmed = false; status.pendingUpload = enabled(); status.backupSaved = false;
  }
  function queueUpload(data) {
    if (!enabled()) return;
    queued = structuredClone(data); markLocalSaved(data);
    if (runner || paused) return;
    runner = Promise.resolve().then(async () => {
      while (queued && !paused) {
        const snapshot = queued; queued = null;
        try { await uploadData(snapshot); } catch (error) {
          queued ||= snapshot; logEvent('sync.upload_pending', { code: error.code || 'REMOTE_UNAVAILABLE' }); break;
        }
      }
    }).finally(() => { runner = null; });
  }
  async function downloadData() {
    try { candidate = await readRemote(); return candidate?.data || null; } catch (error) { throw fail(error); }
  }
  async function confirmDownload(snapshot) {
    if (!candidate || signature(validateData(snapshot)) !== signature(candidate.data)) throw new ConflictError();
    await confirm(snapshot, candidate.metadata, 'download'); candidate = null;
  }
  async function initialize(local, { pending = false, hasLocalHistory = false } = {}) {
    markLocalSaved(local); await load();
    try {
      if (pending && hasLocalHistory) { queueUpload(local); return { data: local, source: 'local-pending' }; }
      const remoteData = await downloadData();
      if (remoteData) return { data: remoteData, source: 'google-drive' };
      await uploadData(local); return { data: local, source: 'local-uploaded' };
    } catch (error) { throw fail(error); }
  }
  async function reconnect() {
    await disconnectClient(); client = null; folder = null; queued = null;
    fail(new AuthRequiredError()); return getStatus();
  }
  const getStatus = () => describe({ ...status, enabled: enabled(), fileId: remote.fileId });
  return { isEnabled: enabled, getStatus, markLocalSaved, initialize, uploadData, queueUpload, downloadData, confirmDownload, createManualBackup: data => backup(data, 'manual').catch(error => { throw fail(error); }),
    createAutomaticBackup: data => backup(data, 'automatic').catch(error => { throw fail(error); }), subscribeConfirmation: observer => { observers.add(observer); return () => observers.delete(observer); },
    async pauseUploads() { paused++; await (runner || uploadSerial); },
    discardQueuedUploads() { queued = null; },
    resumeUploads() { paused = Math.max(0, paused - 1); if (!paused && queued && !runner) queueUpload(queued); },
    recordFailure: fail, waitForUploads: () => runner || uploadSerial, read: downloadData, write: uploadData, reconnect };
}
module.exports = { ...createStorage(), createStorage, ...require('./merge'), validateData, hasConflict, retryOperation };
