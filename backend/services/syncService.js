const { DomainError } = require("../utils/domainError");
const { validateSyncAction } = require('../validators/requests');
const { logEvent } = require('../utils/observability');
function createService(repository) {
    const { writeLocalData, readLocalData, initializeStorage } = repository;
    const googleDriveStorage = repository.drive;
    async function getDriveStatus() {
        await initializeStorage();
        return googleDriveStorage.getStatus();
    }
    async function syncDrive(action = "sync") {
        validateSyncAction(action);
        await initializeStorage();
        try {
            if (action === "download") {
                const localData = await readLocalData();
                const remoteData = await googleDriveStorage.downloadData();
                if (!remoteData)
                    throw new DomainError({ error: "fino-data.json was not found on Google Drive." }, 404);
                await googleDriveStorage.createManualBackup(localData);
                await writeLocalData(remoteData);
            }
            else if (action === "backup") {
                const localData = await readLocalData();
                await googleDriveStorage.createManualBackup(localData);
            }
            else if (action === "reconnect") {
                await googleDriveStorage.reconnect();
            }
            else {
                const localData = await readLocalData();
                await googleDriveStorage.uploadData(localData);
            }
            return { success: true, action, status: googleDriveStorage.getStatus() };
        } catch (error) {
            logEvent('sync.failed', { action, code: error.code || error.category || 'EXTERNAL_API_FAILURE' });
            if (error.code === 'GOOGLE_DRIVE_CONFLICT') throw new DomainError({ error: 'Google Drive has conflicting changes. Choose which version to keep.', status: googleDriveStorage.getStatus() }, 409);
            throw error;
        }
    }
    return { getDriveStatus, syncDrive };
}
module.exports = { createService };
