// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createRenderersSync({ FinoI18n, document, ui }) {
// renderers/sync.js
function driveStatusLabel(status) {
  if (status.syncing) return "Syncing";
  if (status.state) return ({ 'local-saved': 'Saved locally', 'sync-pending': 'Saved locally — upload pending', 'sync-confirmed': 'Synced', conflict: 'Conflict detected', 'auth-required': 'Authorization required' })[status.state] || 'Saved locally';
  if (status.authorizationRequired) return "Authorization required";
  if (status.conflict) return "Conflict detected";
  if (status.error) return "Offline — changes saved locally";
  if (status.pendingUpload && status.connected) return "Pending upload";
  if (status.remoteConfirmed === true && !status.pendingUpload) return "Synced";
  return "Offline — changes saved locally";
}

function renderGoogleDriveStatus(status) {
  ui?.asset?.setSyncStatus(status);
  const label = driveStatusLabel(status);
  document.querySelectorAll(".drive-sync-panel").forEach((panel) => {
    panel.classList.toggle("is-offline", !status.connected && !status.authorizationRequired && !status.conflict);
    panel.classList.toggle("is-auth", Boolean(status.authorizationRequired));
    panel.classList.toggle("is-conflict", Boolean(status.conflict));
    panel.querySelectorAll('[data-drive-conflict]').forEach(button => { button.hidden = !status.conflict; });
    panel.querySelector("[data-drive-connection]").textContent = status.connected
      ? `Google Drive: ${status.email || "Connected"}`
      : "Google Drive: Offline";
    panel.querySelector("[data-drive-state]").textContent = label;
    panel.querySelector("[data-drive-last-sync]").textContent = `${FinoI18n?.t("Last sync:") || "Last sync:"} ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString(FinoI18n?.locale || "en", { dateStyle: "short", timeStyle: "short" }) : "—"}`;
    panel.querySelectorAll("[data-drive-action]").forEach((button) => { button.disabled = Boolean(status.syncing); });
  });
}
return { driveStatusLabel, renderGoogleDriveStatus };
}
