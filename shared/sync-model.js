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
  function summary(snapshot) {
    if (!snapshot) return null;
    const count = value => Array.isArray(value) ? value.length : 0;
    const sync = snapshot.sync || {};
    return { revision: Number.isSafeInteger(sync.revision) && sync.revision >= 0 ? sync.revision : null,
      updatedAt: typeof sync.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(sync.updatedAt) && Number.isFinite(Date.parse(sync.updatedAt)) ? sync.updatedAt : null,
      deviceId: typeof sync.deviceId === 'string' ? sync.deviceId.replace(/[\u0000-\u001f]/g, '').slice(0, 100) : null,
      counts: { assets: count(snapshot.assets), transactions: count(snapshot.transactions), sales: count(snapshot.sales), payments: count(snapshot.payments),
        receivedPayments: (snapshot.payments || []).filter(item => item.status === 'received' || item.status === 'paid' || item.received === true).length,
        expenses: count(snapshot.wallet?.expenses), loans: count(snapshot.wallet?.loans), notes: count(snapshot.calendarNotes) } };
  }
  async function comparison(local, remote, scope = '') {
    const collections = value => ({ assets: value?.assets || [], transactions: value?.transactions || [], sales: value?.sales || [], payments: value?.payments || [], expenses: value?.wallet?.expenses || [], loans: value?.wallet?.loans || [], notes: value?.calendarNotes || [] });
    const left = collections(local), right = collections(remote), differences = {};
    for (const key of Object.keys(left)) {
      const a = new Map(left[key].map(item => [item.id, item])), b = new Map(right[key].map(item => [item.id, item]));
      differences[key] = { localOnly: [...a.keys()].filter(id => !b.has(id)).length, remoteOnly: [...b.keys()].filter(id => !a.has(id)).length,
        changed: [...a.keys()].filter(id => b.has(id) && signature(a.get(id)) !== signature(b.get(id))).length };
    }
    return { local: summary(local), remote: summary(remote), differences,
      plansDiffer: signature(local?.wallet?.months || {}) !== signature(remote?.wallet?.months || {}),
      targetsDiffer: signature(local?.rebalance || null) !== signature(remote?.rebalance || null), token: await comparisonToken(local, remote, scope) };
  }
  const comparisonToken = (local, remote, scope = '') => checksum({ local, remote, scope });
  return { STATES, lifecycle, describe, signature, checksum, summary, comparison, comparisonToken };
});
