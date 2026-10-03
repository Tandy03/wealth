(function () {
const state = stateStore.getState();
// Sync status orchestration.
async function refreshGoogleDriveStatus() {
  try { renderGoogleDriveStatus(await api.getGoogleDriveStatus()); }
  catch (_) { renderGoogleDriveStatus({ connected: false, error: true }); }
}
Object.assign(window, { refreshGoogleDriveStatus });
})();
