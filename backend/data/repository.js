const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const defaultDrive = require("../services/googleDrive/storage");
const { normalizeNumber } = require("../utils/values");
const { createEmptyState, normalizeState, validateState } = require('../../frontend/js/state-model');
const { logEvent } = require('../utils/observability');
const { DomainError } = require('../utils/domainError');
function storageFailure(error) {
    if (error instanceof DomainError) return error;
    const failure = new DomainError({ error: 'Could not access local portfolio storage. Your last saved data has been preserved.' }, 503);
    failure.cause = error;
    failure.code = 'STORAGE_FAILURE';
    return failure;
}
/** One repository and mutation queue per application; tests can supply isolated storage. */
function createRepository({ dataFile = path.join(__dirname, "data.json"), drive = defaultDrive } = {}) {
    const DATA_FILE = dataFile;
    const googleDriveStorage = drive;
    let storageInitializationPromise = null;
    let mutationQueue = Promise.resolve();
    function runMutation(operation) {
        const result = mutationQueue.then(operation, operation);
        mutationQueue = result.catch(() => { });
        return result;
    }
    async function readData() {
        await initializeStorage();
        try {
            const raw = await fs.readFile(DATA_FILE, "utf8");
            const data = JSON.parse(raw);
            return normalizeState(data);
        }
        catch (error) {
            /*
             * If data.json does not exist,
             * create an empty data structure.
             */
            if (error.code === "ENOENT") {
                const emptyData = createEmptyState();
                await saveData(emptyData);
                return emptyData;
            }
            logEvent('storage.read_failed', { code: error.code || 'INVALID_STORED_DATA' });
            throw storageFailure(error);
        }
    }
    async function saveData(data) {
        validateState(data);
        const previousRevision = normalizeNumber(data.sync?.revision);
        const snapshot = normalizeState(data);
        snapshot.sync = { revision: previousRevision + 1, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
        await writeLocalData(snapshot);
        data.sync = snapshot.sync;
        if (googleDriveStorage.isEnabled()) {
            // Do not keep API responses waiting on Google. The queue keeps only the
            // newest snapshot and serializes uploads in the background.
            try { googleDriveStorage.queueUpload(snapshot); }
            catch (error) { logEvent('sync.queue_failed', { code: error.code || 'EXTERNAL_API_FAILURE' }); }
        }
    }
    async function writeLocalData(data) {
        const snapshot = normalizeState(data);
        const temporaryFile = `${DATA_FILE}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
            await fs.writeFile(temporaryFile, JSON.stringify(snapshot, null, 2), "utf8");
            await fs.rename(temporaryFile, DATA_FILE);
        } catch (error) {
            await fs.unlink(temporaryFile).catch(() => {});
            logEvent('storage.write_failed', { code: error.code || 'STORAGE_FAILURE' });
            throw storageFailure(error);
        }
    }
    async function initializeStorage() {
        if (storageInitializationPromise)
            return storageInitializationPromise;
        storageInitializationPromise = (async () => {
            if (!googleDriveStorage.isEnabled()) {
                // Readers and mutations share this promise on the first run.
                // Initialize before allowing any request to read or modify JSON.
                try { await fs.access(DATA_FILE); }
                catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                    await saveData(createEmptyState());
                }
                return;
            }
            let localData;
            try {
                localData = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
                localData = { ...createEmptyState(), sync: { revision: 0, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() } };
            }
            if (!localData.sync || typeof localData.sync !== "object")
                localData.sync = { revision: 0, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
            try {
                const initialized = await googleDriveStorage.initialize(localData);
                const needsSyncMetadata = !initialized.data.sync || typeof initialized.data.sync !== "object";
                if (needsSyncMetadata) {
                    initialized.data.sync = { revision: 1, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
                }
                await writeLocalData(initialized.data);
                if (needsSyncMetadata) {
                    try { await googleDriveStorage.uploadData(initialized.data); }
                    catch (error) {
                        // The downloaded snapshot is already committed locally; upload failure must not undo it.
                        logEvent('sync.initial_upload_failed', { code: error.code || 'EXTERNAL_API_FAILURE' });
                    }
                }
                console.log(`Data storage initialized from ${initialized.source}.`);
            }
            catch (error) {
                console.error(`Google Drive initialization failed; using local data: ${error.message}`);
                await writeLocalData(localData);
            }
        })().catch(error => {
            storageInitializationPromise = null;
            throw storageFailure(error);
        });
        return storageInitializationPromise;
    }
    async function readLocalData() {
        try { return normalizeState(JSON.parse(await fs.readFile(DATA_FILE, "utf8"))); }
        catch (error) {
            logEvent('storage.read_failed', { code: error.code || 'INVALID_STORED_DATA' });
            throw storageFailure(error);
        }
    }
    return { readData, saveData, writeData: saveData, writeLocalData, readLocalData, initializeStorage, runMutation, drive };
}
module.exports = { createRepository };
