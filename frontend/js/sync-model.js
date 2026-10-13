(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FinoSyncModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATES = Object.freeze(['local-saved', 'sync-pending', 'sync-confirmed', 'conflict', 'auth-required']);
  function lifecycle(status = {}) {
    if (status.authorizationRequired) return 'auth-required';
    if (status.conflict) return 'conflict';
    if (status.pendingUpload) return 'sync-pending';
    if (status.remoteConfirmed === true) return 'sync-confirmed';
    return 'local-saved';
  }
  function describe(status = {}) {
    const state = lifecycle(status);
    return { ...status, state, savedLocally: Boolean(status.savedLocally), savedRemotely: state === 'sync-confirmed',
      backupSaved: Boolean(status.backupSaved), pendingUpload: Boolean(status.pendingUpload) };
  }
  function signature(value) {
    const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
    return JSON.stringify(canonical(value));
  }
  async function checksum(value) {
    const engine = typeof module === 'object' && module.exports ? require('node:crypto').webcrypto : globalThis.crypto;
    const bytes = new TextEncoder().encode(signature(value));
    const hash = await engine.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return { STATES, lifecycle, describe, signature, checksum };
});
