const { runMutation } = require('../domain/mutation');
const { DomainError } = require("../utils/domainError");
const { validateSyncAction } = require('../validators/requests');
const { digest } = require('../data/journal');
const { ConflictError, syncError } = require('../../shared/errors');
function createService(repository) {
    const { writeLocalData, readLocalData, initializeStorage } = repository;
    const googleDriveStorage = repository.drive;
    async function getDriveStatus() {
        await initializeStorage();
        return repository.getSyncStatus?.() || googleDriveStorage.getStatus();
    }
    async function syncDrive(action = "sync") {
        validateSyncAction(action);
        await initializeStorage();
        await repository.waitForRemoteInitialization?.();
        const previousBackupId = googleDriveStorage.getStatus().lastBackupId;
        try {
            if (action === "download") {
                await googleDriveStorage.pauseUploads?.();
                try {
                const localData = await readLocalData();
                const remoteData = await googleDriveStorage.downloadData();
                if (!remoteData)
                    throw new DomainError({ error: "fino-data.json was not found on Google Drive." }, 404);
                await (googleDriveStorage.createAutomaticBackup || googleDriveStorage.createManualBackup)(localData);
                await runMutation(repository, async () => {
                    if (digest(await readLocalData()) !== digest(localData)) throw new ConflictError({ message: 'Local changes were saved while downloading. Retry without discarding them.' });
                    await writeLocalData(remoteData);
                    await googleDriveStorage.confirmDownload?.(remoteData);
                    if (!googleDriveStorage.subscribeConfirmation) await repository.acknowledgeRemote?.(remoteData);
                    googleDriveStorage.discardQueuedUploads?.();
                });
                } finally { googleDriveStorage.resumeUploads?.(); }
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
                await googleDriveStorage.uploadData(localData, 3, { force: action === 'upload' });
                if (!googleDriveStorage.subscribeConfirmation) await repository.acknowledgeRemote?.(localData);
            }
            const status = repository.getSyncStatus?.() || googleDriveStorage.getStatus();
            return { success: true, action, savedLocally: Boolean(status.savedLocally), savedRemotely: Boolean(status.savedRemotely),
                backupSaved: action === 'backup' || action === 'download' ? true : Boolean(status.lastBackupId && status.lastBackupId !== previousBackupId), status };
        } catch (error) {
            if (error instanceof DomainError) throw error;
            const failure = syncError(error);
            googleDriveStorage.recordFailure?.(failure);
            failure.payload.status = repository.getSyncStatus?.() || googleDriveStorage.getStatus();
            throw failure;
        }
    }
    return { getDriveStatus, syncDrive };
}
module.exports = { createService };
