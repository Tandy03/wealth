// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createControllersSync({ api, renderGoogleDriveStatus, stateStore }) {
const state = stateStore.getState();
// Sync status orchestration.
async function refreshGoogleDriveStatus() {
  try { renderGoogleDriveStatus(await api.getGoogleDriveStatus()); }
  catch (_) { renderGoogleDriveStatus({ connected: false, error: true }); }
}
return { refreshGoogleDriveStatus };
}
