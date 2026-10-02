const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const { google } = require("googleapis");
const { createAuthorizedClient, disconnect } = require("./auth");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const statePath = path.resolve(projectRoot, process.env.GOOGLE_DRIVE_STATE_PATH || "backend/config/google-drive-state.json");
const fileName = process.env.GOOGLE_DRIVE_FILE_NAME || "fino-data.json";
const backupFolderName = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_NAME || "fino-backups";
const backupRetention = Math.max(1, Number(process.env.GOOGLE_DRIVE_BACKUP_RETENTION) || 10);

let driveClientPromise = null;
let backupFolderPromise = null;
let uploadSerial = Promise.resolve();
let queuedUploadData = null;
let queueRunner = null;
let remoteState = { fileId: String(process.env.GOOGLE_DRIVE_FILE_ID || "").trim() || null, version: null, modifiedTime: null, md5Checksum: null, dataRevision: null };
let status = { enabled: process.env.GOOGLE_DRIVE_SYNC_ENABLED === "true", connected: false, syncing: false, pendingUpload: false, conflict: false, authorizationRequired: false, lastSyncAt: null, lastDirection: null, error: null, fileId: remoteState.fileId };

function isEnabled() { return process.env.GOOGLE_DRIVE_SYNC_ENABLED === "true"; }
function serializeData(data) { return JSON.stringify(data, null, 2); }
function dataChecksum(data) { return createHash("md5").update(serializeData(data)).digest("hex"); }

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function getDrive() {
  if (!isEnabled()) throw new Error("Google Drive synchronization is disabled.");
  if (!driveClientPromise) driveClientPromise = (async () => {
    const auth = await createAuthorizedClient();
    status.connected = true;
    status.authorizationRequired = false;
    return google.drive({ version: "v3", auth });
  })().catch((error) => { driveClientPromise = null; status.connected = false; status.authorizationRequired = error.code === "GOOGLE_AUTH_REQUIRED"; status.error = error.message; throw error; });
  return driveClientPromise;
}

async function loadState() {
  if (remoteState.fileId) return;
  const saved = await readJson(statePath).catch(() => null);
  if (saved?.fileId) remoteState = { ...remoteState, ...saved };
}

async function persistState(metadata, dataRevision = remoteState.dataRevision) {
  remoteState = { fileId: metadata.id || remoteState.fileId, version: metadata.version || null, modifiedTime: metadata.modifiedTime || null, md5Checksum: metadata.md5Checksum || null, dataRevision: Number.isFinite(Number(dataRevision ?? metadata.appProperties?.finoRevision)) ? Number(dataRevision ?? metadata.appProperties?.finoRevision) : null };
  status.fileId = remoteState.fileId;
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(remoteState, null, 2), "utf8");
}

async function locateFile(drive) {
  await loadState();
  if (remoteState.fileId) {
    try {
      const result = await drive.files.get({ fileId: remoteState.fileId, fields: "id,name,version,modifiedTime,md5Checksum,appProperties,trashed" });
      if (!result.data.trashed) return result.data;
    } catch (error) {
      if (error.code !== 404) throw error;
      remoteState.fileId = null;
    }
  }
  const escapedName = fileName.replace(/'/g, "\\'");
  const result = await drive.files.list({ q: `name = '${escapedName}' and trashed = false`, spaces: "drive", pageSize: 10, orderBy: "modifiedTime desc", fields: "files(id,name,version,modifiedTime,md5Checksum,appProperties)" });
  return result.data.files?.[0] || null;
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Google Drive file does not contain a JSON object.");
  for (const key of ["assets", "transactions", "payments"]) if (data[key] != null && !Array.isArray(data[key])) throw new Error(`Google Drive data has an invalid ${key} collection.`);
  return data;
}

function hasConflict({ expectedChecksum, actualChecksum, knownRevision, remoteRevision }) {
  if (expectedChecksum && actualChecksum && expectedChecksum !== actualChecksum) return true;
  return Number.isFinite(Number(knownRevision)) && Number.isFinite(Number(remoteRevision)) && Number(remoteRevision) > Number(knownRevision);
}

async function createRemote(drive, data) {
  const result = await drive.files.create({
    requestBody: { name: fileName, mimeType: "application/json", description: "fino application data — managed automatically", appProperties: { finoRevision: String(data.sync?.revision || 0) } },
    media: { mimeType: "application/json", body: Readable.from([serializeData(data)]) },
    fields: "id,name,version,modifiedTime,md5Checksum,appProperties",
  });
  await persistState(result.data, data.sync?.revision);
  return result.data;
}

async function getBackupFolder(drive) {
  if (backupFolderPromise) return backupFolderPromise;
  backupFolderPromise = (async () => {
  const escapedName = backupFolderName.replace(/'/g, "\\'");
  const found = await drive.files.list({ q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, spaces: "drive", pageSize: 1, fields: "files(id)" });
  if (found.data.files?.[0]) return found.data.files[0].id;
  const created = await drive.files.create({ requestBody: { name: backupFolderName, mimeType: "application/vnd.google-apps.folder" }, fields: "id" });
  return created.data.id;
  })().catch((error) => { backupFolderPromise = null; throw error; });
  return backupFolderPromise;
}

function backupName() { return `fino-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`; }

async function createBackup(drive, data, reason = "automatic") {
  const folderId = await getBackupFolder(drive);
  const result = await drive.files.create({
    requestBody: { name: backupName(), parents: [folderId], mimeType: "application/json", description: `fino ${reason} backup` },
    media: { mimeType: "application/json", body: Readable.from([serializeData(data)]) }, fields: "id,name,createdTime",
  });
  const backups = await drive.files.list({ q: `'${folderId}' in parents and trashed = false`, orderBy: "createdTime desc", pageSize: 100, fields: "files(id,name,createdTime)" });
  await Promise.all((backups.data.files || []).slice(backupRetention).map((file) => drive.files.delete({ fileId: file.id }).catch(() => null)));
  return result.data;
}

async function trimBackups(drive, folderId) {
  const backups = await drive.files.list({ q: `'${folderId}' in parents and trashed = false`, orderBy: "createdTime desc", pageSize: 100, fields: "files(id)" });
  await Promise.all((backups.data.files || []).slice(backupRetention).map((file) => drive.files.delete({ fileId: file.id }).catch(() => null)));
}

async function copyRemoteToBackup(drive, fileId) {
  const folderId = await getBackupFolder(drive);
  const backup = await drive.files.copy({ fileId, requestBody: { name: backupName(), parents: [folderId], description: "fino automatic backup before replacement" }, fields: "id,name,createdTime" });
  trimBackups(drive, folderId).catch((error) => console.error("Could not trim Google Drive backups:", error.message));
  return backup.data;
}

async function downloadData() {
  const drive = await getDrive();
  await loadState();
  let metadata;
  let result;
  if (remoteState.fileId) {
    try {
      [metadata, result] = await Promise.all([
        drive.files.get({ fileId: remoteState.fileId, fields: "id,name,version,modifiedTime,md5Checksum,appProperties,trashed" }).then((response) => response.data),
        drive.files.get({ fileId: remoteState.fileId, alt: "media" }, { responseType: "text" }),
      ]);
    } catch (error) {
      if (error.code !== 404) throw error;
      remoteState.fileId = null;
    }
  }
  if (!metadata) metadata = await locateFile(drive);
  if (!metadata) return null;
  if (!result) result = await drive.files.get({ fileId: metadata.id, alt: "media" }, { responseType: "text" });
  const data = validateData(typeof result.data === "string" ? JSON.parse(result.data) : result.data);
  await persistState(metadata, data.sync?.revision);
  status = { ...status, connected: true, pendingUpload: false, conflict: false, authorizationRequired: false, lastSyncAt: new Date().toISOString(), lastDirection: "download", error: null };
  return data;
}

async function initialize(localData) {
  if (!isEnabled()) return { data: localData, source: "local", enabled: false };
  status.syncing = true;
  try {
    const remoteData = await downloadData();
    if (remoteData) return { data: remoteData, source: "google-drive", enabled: true };
    const drive = await getDrive();
    await createRemote(drive, localData);
    status = { ...status, connected: true, pendingUpload: false, conflict: false, authorizationRequired: false, lastSyncAt: new Date().toISOString(), lastDirection: "upload", error: null };
    return { data: localData, source: "local-uploaded", enabled: true };
  } catch (error) {
    status = { ...status, connected: false, authorizationRequired: error.code === "GOOGLE_AUTH_REQUIRED", error: error.message };
    throw error;
  } finally { status.syncing = false; }
}

async function uploadDataOnce(data) {
  if (!isEnabled()) return;
  status.syncing = true;
  try {
    const drive = await getDrive();
    await loadState();
    const expectedChecksum = remoteState.md5Checksum;
    let metadata = await locateFile(drive);
    if (!metadata) metadata = await createRemote(drive, data);
    else {
      if (hasConflict({ expectedChecksum, actualChecksum: metadata.md5Checksum })) {
        const conflict = new Error("Google Drive contains a newer version of fino-data.json. Download it before uploading local changes.");
        conflict.code = "GOOGLE_DRIVE_CONFLICT";
        throw conflict;
      }
      if (metadata.md5Checksum && metadata.md5Checksum === dataChecksum(data)) {
        await persistState(metadata, data.sync?.revision);
        status = { ...status, connected: true, pendingUpload: false, conflict: false, authorizationRequired: false, lastSyncAt: new Date().toISOString(), lastDirection: "upload", error: null };
        return;
      }
      const knownRevision = Number(remoteState.dataRevision);
      const remoteRevision = Number(metadata.appProperties?.finoRevision);
      if (hasConflict({ knownRevision, remoteRevision })) {
        const conflict = new Error("Google Drive contains a newer data revision. Download it before uploading local changes.");
        conflict.code = "GOOGLE_DRIVE_CONFLICT";
        throw conflict;
      }
      await copyRemoteToBackup(drive, metadata.id);
      const result = await drive.files.update({ fileId: metadata.id, requestBody: { appProperties: { finoRevision: String(data.sync?.revision || 0) } }, media: { mimeType: "application/json", body: Readable.from([serializeData(data)]) }, fields: "id,name,version,modifiedTime,md5Checksum,appProperties" });
      await persistState(result.data, data.sync?.revision);
    }
    status = { ...status, connected: true, pendingUpload: false, conflict: false, authorizationRequired: false, lastSyncAt: new Date().toISOString(), lastDirection: "upload", error: null };
  } catch (error) {
    status = { ...status, connected: false, pendingUpload: true, conflict: error.code === "GOOGLE_DRIVE_CONFLICT", authorizationRequired: error.code === "GOOGLE_AUTH_REQUIRED", error: error.message };
    throw error;
  } finally { status.syncing = false; }
}

async function retryOperation(operation, attempts = 3, delay = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (error.code === "GOOGLE_DRIVE_CONFLICT" || error.code === "GOOGLE_AUTH_REQUIRED" || attempt === attempts) break;
      await delay(250 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function uploadData(data, attempts = 3) {
  const operation = uploadSerial.then(() => retryOperation(() => uploadDataOnce(data), attempts));
  uploadSerial = operation.catch(() => {});
  return operation;
}

function queueUpload(data) {
  if (!isEnabled()) return;
  queuedUploadData = JSON.parse(JSON.stringify(data));
  status.pendingUpload = true;
  if (queueRunner) return;
  queueRunner = Promise.resolve().then(async () => {
    while (queuedUploadData) {
      const latest = queuedUploadData;
      queuedUploadData = null;
      try { await uploadData(latest); }
      catch (error) {
        console.error(`Google Drive background upload pending: ${error.message}`);
        break;
      }
    }
  }).finally(() => { queueRunner = null; });
}

async function createManualBackup(data) {
  const drive = await getDrive();
  const backup = await createBackup(drive, validateData(data), "manual");
  status = { ...status, connected: true, lastSyncAt: new Date().toISOString(), lastDirection: "backup", error: null };
  return backup;
}

async function reconnect() {
  await disconnect();
  driveClientPromise = null;
  status = { ...status, connected: false, authorizationRequired: true, error: "Run npm run google-auth, then restart the server." };
  return getStatus();
}

function getStatus() { return { ...status }; }

module.exports = { initialize, read: downloadData, write: uploadData, ...require('./merge'), uploadData, queueUpload, downloadData, createManualBackup, reconnect, getStatus, isEnabled, validateData, hasConflict, retryOperation };
