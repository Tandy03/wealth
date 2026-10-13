(function () {
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) return;

  const proxyConfig = window.FINO_MOBILE_CONFIG || {};
  const validation = window.FinoValidation;
  const rules = window.FinoPortfolioRules;
  const errors = window.FinoErrors;
  const syncModel = window.FinoSyncModel;
  const fetch = async (...args) => {
    const response = await window.FinoRequest.fetchWithTimeout(...args);
    if (response.status === 401) { try { await response.json(); } catch {} throw new errors.AuthRequiredError(); }
    return response;
  };
  const { DAYS_PER_YEAR, MILLISECONDS_PER_DAY, QUANTITY_EPSILON, DEFAULT_BOND_REDEMPTION } = window.FinoConstants;
  const LEGACY_STORAGE_KEY = "fino-data-v1";
  const MIGRATION_OWNER_KEY = "fino-account-migration-owner";
  const emptyData = () => ({
    ...window.FinoStateModel.createEmptyState(),
    sync: { revision: 0, updatedAt: new Date().toISOString(), deviceId: "android-phone" },
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const number = (value) => { const result = Number(value || 0); return Number.isFinite(result) ? result : 0; };
  const soldQuantity = (state, assetId) => (state.sales || []).filter((sale) => sale.assetId === assetId).reduce((sum, sale) => sum + number(sale.quantity), 0);
  const availableQuantity = (state, asset, targetDate) => targetDate ? rules.quantityForSale(state, asset, targetDate) : rules.quantityOnDate(state, asset);
  const isReceived = (payment) => payment.status === "received" || payment.status === "paid" || payment.received;
  const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  function purchasedQuantityOnDate(state, assetId, targetDate) {
    return (state.transactions || [])
      .filter((tx) => tx.assetId === assetId && tx.type === "BUY" && tx.date && tx.date <= targetDate)
      .reduce((sum, tx) => sum + number(tx.quantity), 0);
  }

  function eligibleDividendQuantity(state, asset, paymentDate) { return rules.quantityOnDate(state, asset, rules.dividendRecordDate(asset, { date: paymentDate })); }
  function repairLegacyPurchaseHistory(state) {
    return rules.repairLegacyPurchaseHistory(state);
  }

  function refreshPlannedPaymentAmounts(state) { rules.refreshPayments(state); }
  function validateSnapshot(state) { return window.FinoStateModel.validateState(state); }
  function normalizeData(state) {
    Object.assign(state, window.FinoStateModel.normalizeState(state));
    const renamed = new Map();
    (state.assets || []).forEach((asset) => {
      if (String(asset.name || "").trim().toLowerCase() === "ovdp 1") {
        asset.name = "OVDP 5378";
        renamed.set(asset.id, asset.name);
      }
    });
    [state.transactions, state.payments, state.calendarNotes, state.sales, state.priceHistory].forEach((items = []) => {
      items.forEach((item) => { if (renamed.has(item.assetId)) item.assetName = renamed.get(item.assetId); });
    });
    (state.assets || []).forEach((asset) => {
      if (number(asset.currentPrice) <= 0 || state.priceHistory.some((point) => point.assetId === asset.id)) return;
      recordAssetPrice(state, asset, "initial", asset.lastSyncedAt || asset.updatedAt || asset.createdAt || new Date().toISOString());
    });
    repairLegacyPurchaseHistory(state);
    state.assets.forEach(asset => rules.updateHolding(state, asset));
    const assetIds = new Set((state.assets || []).map((asset) => asset.id));
    state.payments = (state.payments || []).filter((payment) => assetIds.has(payment.assetId) || isReceived(payment));
    refreshPlannedPaymentAmounts(state);
    return state;
  }

  function recordAssetPrice(state, asset, source, recordedAt = new Date().toISOString()) {
    const price = number(asset.currentPrice);
    if (price <= 0 || !(state.assets || []).some((item) => item.id === asset.id)) return;
    state.priceHistory ||= [];
    state.priceHistory.push({
      id: id("price"), assetId: asset.id, assetName: asset.name,
      recordedAt, date: recordedAt.slice(0, 10), price,
      currency: asset.currency || "UAH", source,
    });
  }

  function rebuildPlannedPayments(state, asset) { return rules.rebuildPayments(state, asset, id); }
  const Preferences = window.Capacitor.Plugins.FinoStorage || window.Capacitor.Plugins.Preferences;
  let localHistory = [];
  const DriveAuth = window.Capacitor.Plugins.GoogleDriveAuth;
  let data;
  let syncing = false;
  let authSession = null;
  let activeEmail = "";
  let storageKey = LEGACY_STORAGE_KEY;
  let fileId = null;

  const accountSuffix = (email) => encodeURIComponent(String(email || "").trim().toLowerCase());

  async function ensureAccount(allowOffline = false) {
    let result;
    try { result = await DriveAuth.getAccessToken(); }
    catch (error) {
      authorizationRequired = true;
      if (!allowOffline) throw new errors.AuthRequiredError({ cause: error });
      const saved = await Preferences.get({ key: 'fino-active-account' });
      const email = activeEmail || saved.value;
      if (!email) throw error;
      if (email !== activeEmail) {
        activeEmail = email;
        storageKey = LEGACY_STORAGE_KEY + ':' + accountSuffix(email);
        fileId = (await Preferences.get({ key: 'fino-drive-file:' + accountSuffix(email) })).value || null;
        data = undefined;
        syncMeta = null;
      }
      if (operationActive) {
        if (pinnedAccount && email !== pinnedAccount) {
          const changed = new Error('Google account changed during synchronization. Reconnect and retry.');
          changed.code = 'AUTHORIZATION_REQUIRED';
          throw changed;
        }
        pinnedAccount = email;
      }
      connected = false;
      return { email, accessToken: null };
    }
    if (!result?.accessToken || !result?.email) { const error = new Error("Google Drive authorization required."); error.code = "AUTHORIZATION_REQUIRED"; throw error; }
    const email = String(result.email).trim().toLowerCase();
    if (operationActive) {
      if (pinnedAccount && email !== pinnedAccount) {
        const error = new Error('Google account changed during synchronization. Reconnect and retry; no portfolio was uploaded to the new account.');
        error.code = 'AUTHORIZATION_REQUIRED';
        throw error;
      }
      pinnedAccount = email;
    }
    if (email !== activeEmail) {
      activeEmail = email;
      storageKey = `${LEGACY_STORAGE_KEY}:${accountSuffix(email)}`;
      const savedFile = await Preferences.get({ key: `fino-drive-file:${accountSuffix(email)}` });
      fileId = savedFile.value || null;
      data = undefined;
      syncMeta = null;
      connected = false;
      const accountData = await Preferences.get({ key: storageKey });
      const migrationOwner = await Preferences.get({ key: MIGRATION_OWNER_KEY });
      if (!accountData.value && !migrationOwner.value) {
        const legacy = await Preferences.get({ key: LEGACY_STORAGE_KEY });
        if (legacy.value) await Preferences.set({ key: storageKey, value: legacy.value });
        await Preferences.set({ key: MIGRATION_OWNER_KEY, value: email });
      }
    }
    await Preferences.set({ key: "fino-active-account", value: email });
    authorizationRequired = false;
    authSession = { accessToken: result.accessToken, email };
    return authSession;
  }

  async function loadLocal() {
    await ensureAccount(true);
    if (data) return data;
    localHistory = [];
    const stored = await Preferences.get({ key: storageKey });
    const journal = await Preferences.get({ key: journalKey() });
    let committed = null;
    if (journal.value) {
      try {
        const entries = JSON.parse(journal.value).entries;
        if (!Array.isArray(entries)) throw new Error('Invalid journal');
        for (const entry of entries) {
          validateSnapshot(entry.snapshot);
          if (!entry.metadata || typeof entry.metadata.pendingUpload !== 'boolean' || entry.checksum !== await syncModel.checksum({ snapshot: entry.snapshot, metadata: entry.metadata })) throw new Error('Invalid journal checksum');
        }
        localHistory = entries; committed = entries.at(-1);
      } catch (cause) { throw new errors.StorageError({ message: 'Local recovery journal is corrupted. Preserve device data before restoring a backup.', cause }); }
    }
    let loaded;
    try { loaded = validateSnapshot(committed ? clone(committed.snapshot) : stored.value ? JSON.parse(stored.value) : emptyData()); }
    catch (cause) { throw new errors.StorageError({ message: 'Local portfolio data is corrupted. Restore a backup before making changes.', cause }); }
    const originalSignature = signature(loaded);
    const baseline = stored.value ? originalSignature : null;
    normalizeData(loaded);
    const savedMeta = await Preferences.get({ key: metadataKey() });
    let metadata;
    try { metadata = savedMeta.value ? JSON.parse(savedMeta.value) : null; } catch { metadata = null; }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof metadata.pendingUpload !== 'boolean' || !(metadata.baseline === null || typeof metadata.baseline === 'string')) metadata = null;
    const nextMeta = clone(committed?.metadata || metadata || { baseline, pendingUpload: Boolean(stored.value), conflict: false, error: null, lastSyncAt: null });
    if (signature(loaded) !== originalSignature) {
      loaded.sync = { ...loaded.sync, revision: Number(loaded.sync?.revision || 0) + 1, updatedAt: new Date().toISOString(), deviceId: 'android-phone' };
      Object.assign(nextMeta, { pendingUpload: true, remoteConfirmed: false, backupSaved: false });
      await persistJournal(loaded, nextMeta);
    }
    syncMeta = nextMeta;
    data = loaded;
    return data;
  }

  async function saveLocal() {
    validateSnapshot(data);
    data.sync = {
      revision: Number(data.sync?.revision || 0) + 1,
      updatedAt: new Date().toISOString(), deviceId: "android-phone",
    };
    syncMeta = { ...syncMeta, pendingUpload: true, remoteConfirmed: false, savedLocally: true, backupSaved: false };
    await persistJournal(data, syncMeta);
  }

  async function token() {
    return (await ensureAccount()).accessToken;
  }

  async function rememberFileId(idValue) {
    fileId = idValue;
    await Preferences.set({ key: `fino-drive-file:${accountSuffix(activeEmail)}`, value: idValue });
  }

  async function locateDriveFile(accessToken, allowDeleted = false) {
    if (fileId) {
      const check = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed,ownedByMe`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!check.ok && check.status !== 404) throw new errors.RemoteUnavailableError();
      const details = check.ok ? await check.json() : { trashed: true };
      if (details.trashed) {
        if (!allowDeleted) throw conflictError();
        await Preferences.remove({ key: `fino-drive-file:${accountSuffix(activeEmail)}` });
        fileId = null;
      } else {
        if (details.ownedByMe !== true) throw new errors.AuthRequiredError({ message: 'Portfolio file must belong to the signed-in account.' });
        return fileId;
      }
    }
    const query = new URLSearchParams({
      q: "name = 'fino-data.json' and trashed = false and 'me' in owners",
      spaces: "drive", orderBy: "modifiedTime desc", pageSize: "10", fields: "files(id,name,modifiedTime,appProperties,ownedByMe),nextPageToken",
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Drive file lookup failed (${response.status}).`);
    const listing = await response.json();
    if ((listing.files?.length || 0) > 1 || listing.nextPageToken) throw new errors.ConflictError({ message: 'Multiple portfolio files found. Select one before synchronizing.' });
    const found = listing.files?.[0]?.id;
    if (found) await rememberFileId(found);
    return found || null;
  }

  async function createJsonFile(accessToken, metadata, snapshot) {
    const boundary = 'fino_' + id('upload');
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata)
      + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(snapshot) + '\r\n--' + boundary + '--';
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
    });
    if (!response.ok) throw new Error('Drive file creation failed (' + response.status + ').');
    const createdId = (await response.json()).id;
    if (!createdId) throw new Error('Drive file creation returned no ID.');
    return createdId;
  }
  async function createDriveFile(accessToken, snapshot) {
    const createdId = await createJsonFile(accessToken, { name: 'fino-data.json', mimeType: 'application/json', appProperties: { finoApp: 'true' } }, snapshot);
    await rememberFileId(createdId);
    return createdId;
  }

  let syncMeta = null;
  let connected = false;
  let authorizationRequired = false;
  let operationQueue = Promise.resolve();
  let pinnedAccount = null;
  let operationActive = false;
  const queued = (operation) => {
    const run = async () => {
      operationActive = true;
      pinnedAccount = null;
      try { return await operation(); }
      finally { operationActive = false; pinnedAccount = null; }
    };
    const result = operationQueue.then(run, run);
    operationQueue = result.catch(() => {});
    return result;
  };
  const metadataKey = () => 'fino-sync-v2:' + accountSuffix(activeEmail);
  const journalKey = () => 'fino-journal-v1:' + accountSuffix(activeEmail);
  async function persistJournal(snapshot, metadata) {
    const entry = { snapshot: clone(snapshot), metadata: clone(metadata), checksum: await syncModel.checksum({ snapshot, metadata }), at: new Date().toISOString() };
    const history = localHistory.at(-1) && signature(localHistory.at(-1).snapshot) === signature(snapshot) ? localHistory.slice(0, -1) : localHistory;
    const next = [...history, entry].slice(-50);
    try { await Preferences.set({ key: journalKey(), value: JSON.stringify({ version: 1, entries: next }) }); }
    catch (cause) { throw new errors.StorageError({ cause }); }
    localHistory = next;
    // Journal commit is authoritative. Mirrors can be repaired from it after restart.
    try {
      await Preferences.set({ key: storageKey, value: JSON.stringify(snapshot) });
      await Preferences.set({ key: metadataKey(), value: JSON.stringify(metadata) });
    } catch { console.info('Local journal saved; compatibility cache will be repaired on reload.'); }
  }
  function signature(value) {
    const canonical = (item) => Array.isArray(item) ? item.map(canonical)
      : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])])) : item;
    return JSON.stringify(canonical(value));
  }
  async function persistSyncMeta() {
    if (data) await persistJournal(data, syncMeta);
    else await Preferences.set({ key: metadataKey(), value: JSON.stringify(syncMeta) });
  }
  async function recordSyncError(error) {
    const failure = errors.syncError(error);
    connected = failure.category === 'conflict';
    authorizationRequired = failure.category === 'auth_required';
    if (syncMeta) {
      syncMeta.error = failure.message; syncMeta.errorCode = failure.code;
      syncMeta.conflict = failure.category === 'conflict';
      try { await persistSyncMeta(); } catch { console.info('Sync status persistence pending; local journal remains available.'); }
    }
  }
  function conflictError() {
    return new errors.ConflictError();
  }
  function statusSnapshot() {
    const status = syncModel.describe({ enabled: true, connected, authorizationRequired, syncing, savedLocally: Boolean(data), remoteConfirmed: Boolean(syncMeta?.remoteConfirmed), backupSaved: Boolean(syncMeta?.backupSaved), pendingUpload: Boolean(syncMeta?.pendingUpload), conflict: Boolean(syncMeta?.conflict), error: syncMeta?.error || null, errorCode: syncMeta?.errorCode || null,
      lastSyncAt: syncMeta?.lastSyncAt || null, fileId, email: activeEmail,
    });
    status.status = syncing ? 'Syncing' : ({ 'local-saved': 'Saved locally', 'sync-pending': 'Pending upload', 'sync-confirmed': 'Synced', conflict: 'Conflict detected', 'auth-required': 'Authorization required' })[status.state];
    return status;
  }
  async function finishSync(snapshot) {
    const previous = syncMeta;
    const confirmed = signature(data) === signature(snapshot);
    syncMeta = { ...syncMeta, baseline: signature(snapshot), pendingUpload: !confirmed, remoteConfirmed: confirmed, conflict: false, error: null, errorCode: null, confirmedRevision: snapshot.sync?.revision || 0, lastSyncAt: new Date().toISOString() };
    try { await persistSyncMeta(); } catch (error) { syncMeta = previous; throw error; }
    connected = true;
    authorizationRequired = false;
  }
  async function readRemote(allowInvalid = false) {
    const accessToken = await token();
    const currentFileId = await locateDriveFile(accessToken, allowInvalid);
    if (!currentFileId) return null;
    const metadataUrl = 'https://www.googleapis.com/drive/v3/files/' + currentFileId + '?fields=id,version,md5Checksum,ownedByMe,trashed';
    const metadata = await fetch(metadataUrl, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!metadata.ok) throw new Error('Drive metadata lookup failed (' + metadata.status + ').');
    const before = await metadata.json();
    if (before.version == null || typeof before.md5Checksum !== 'string') throw new errors.RemoteUnavailableError();
    if (before.trashed) throw conflictError();
    if (before.ownedByMe !== true) throw new errors.AuthRequiredError({ message: 'Portfolio file must belong to the signed-in account.' });
    const response = await fetch('https://www.googleapis.com/drive/v3/files/' + currentFileId + '?alt=media', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!response.ok) throw new Error('Drive download failed (' + response.status + ').');
    let raw;
    let remote;
    raw = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    const checked = await fetch(metadataUrl, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!checked.ok) throw conflictError();
    const after = await checked.json();
    if (after.trashed || after.ownedByMe !== true || String(before.version) !== String(after.version) || before.md5Checksum !== after.md5Checksum) throw conflictError();
    try {
      remote = validateSnapshot(JSON.parse(raw));
    } catch (error) {
      if (!allowInvalid) throw new errors.ValidationError({ message: 'Drive file contains invalid data. Local data was preserved; use Upload to replace it after a backup.' });
      return { data: null, contentSignature: raw || '', etag: metadata.headers?.get?.('etag') || null, valid: false };
    }
    return { data: remote, contentSignature: signature(remote), etag: metadata.headers?.get?.('etag') || null, valid: true };
  }

  async function backupFolder(accessToken) {
    const query = new URLSearchParams({ q: "name = 'fino-backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'me' in owners", fields: 'files(id)', pageSize: '1' });
    const found = await fetch('https://www.googleapis.com/drive/v3/files?' + query, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!found.ok) throw new Error('Drive backup folder lookup failed (' + found.status + ').');
    const folderId = (await found.json()).files?.[0]?.id;
    if (folderId) {
      const metadata = await fetch('https://www.googleapis.com/drive/v3/files/' + folderId + '?fields=id,ownedByMe,permissions(type,role)', { headers: { Authorization: 'Bearer ' + accessToken } });
      if (!metadata.ok) throw new errors.AuthRequiredError();
      const details = await metadata.json();
      if (details.ownedByMe !== true || !Array.isArray(details.permissions) || details.permissions.some(permission => permission.type !== 'user' || permission.role !== 'owner')) throw new errors.AuthRequiredError({ message: 'Backup folder must be private to its owner.' });
      return folderId;
    }
    const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fino-backups', mimeType: 'application/vnd.google-apps.folder' }) });
    if (!created.ok) throw new Error('Drive backup folder creation failed (' + created.status + ').');
    return (await created.json()).id;
  }
  async function backupLocal(snapshot, reason) {
    // Keep a recovery copy on the device even if the cloud backup fails.
    await Preferences.set({ key: 'fino-recovery:' + accountSuffix(activeEmail), value: JSON.stringify(snapshot) });
    const accessToken = await token();
    const folderId = await backupFolder(accessToken);
    const kind = reason === 'manual' ? 'manual' : 'automatic';
    const result = await createJsonFile(accessToken, { name: 'fino-data-' + Date.now() + '-' + id('backup') + '.json', mimeType: 'application/json', parents: [folderId], description: 'fino ' + reason + ' backup', appProperties: { finoBackup: 'true', kind } }, snapshot);
    syncMeta.backupSaved = true; syncMeta.lastBackupKind = kind; syncMeta.lastBackupId = result;
    await trimBackups(accessToken, folderId, kind);
    return result;
  }

  async function trimBackups(accessToken, folderId, kind) {
    try {
      const query = new URLSearchParams({ q: "'" + folderId + "' in parents and trashed = false and 'me' in owners and appProperties has { key='finoBackup' and value='true' } and appProperties has { key='kind' and value='" + kind + "' }", fields: 'files(id,ownedByMe,createdTime,appProperties)', orderBy: 'createdTime desc', pageSize: '100' });
      const response = await fetch('https://www.googleapis.com/drive/v3/files?' + query, { headers: { Authorization: 'Bearer ' + accessToken } });
      if (!response.ok) return;
      const files = (await response.json()).files || [];
      for (const [index, file] of files.entries()) {
        if (file.ownedByMe !== true || file.appProperties?.finoBackup !== 'true' || file.appProperties?.kind !== kind) continue;
        if (index >= (kind === 'manual' ? 30 : 10) || Date.now() - Date.parse(file.createdTime) > (kind === 'manual' ? 90 : 30) * 86400000) await fetch('https://www.googleapis.com/drive/v3/files/' + file.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + accessToken } });
      }
    } catch { console.info('Drive backup retention pending.'); }
  }

  async function backupRemote(accessToken, remoteId) {
    const folderId = await backupFolder(accessToken);
    const response = await fetch('https://www.googleapis.com/drive/v3/files/' + remoteId + '/copy?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fino-data-' + Date.now() + '-' + id('backup') + '.json', parents: [folderId], description: 'fino backup before replacement', appProperties: { finoBackup: 'true', kind: 'automatic' } }) });
    if (!response.ok) throw new Error('Drive remote backup failed (' + response.status + ').');
    const created = await response.json();
    if (!created.id) throw new errors.RemoteUnavailableError();
    syncMeta.backupSaved = true; syncMeta.lastBackupKind = 'automatic'; syncMeta.lastBackupId = created.id;
    await trimBackups(accessToken, folderId, 'automatic');
  }
  async function adoptRemote(remote) {
    const next = normalizeData(clone(remote));
    if (signature(next) !== signature(remote)) next.sync = { ...next.sync, revision: Number(next.sync?.revision || 0) + 1, updatedAt: new Date().toISOString(), deviceId: 'android-phone' };
    const previous = data, previousMeta = clone(syncMeta);
    data = next;
    try { await finishSync(remote); } catch (error) { data = previous; syncMeta = previousMeta; throw error; }
  }
  async function uploadDrive(force = false) {
    await loadLocal();
    const snapshot = clone(data);
    const remote = await readRemote(force);
    if (!force && remote && signature(remote.data) !== syncMeta.baseline && signature(remote.data) !== signature(snapshot)) throw conflictError();
    if (!force && !remote && syncMeta.baseline) throw conflictError();
    if (remote && signature(remote.data) === signature(snapshot)) { await finishSync(snapshot); return; }
    const accessToken = await token();
    if (remote) {
      await backupRemote(accessToken, fileId);
      const checked = await readRemote(force);
      if (!checked || checked.contentSignature !== remote.contentSignature) throw conflictError();
      remote.etag = checked.etag;
    }
    if (!fileId) {
      await createDriveFile(accessToken, snapshot);
      const verified = await readRemote();
      if (!verified || signature(verified.data) !== signature(snapshot)) throw conflictError();
      await finishSync(snapshot); return;
    }
    const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
    if (remote?.etag) headers['If-Match'] = remote.etag;
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', { method: 'PATCH', headers, body: JSON.stringify(snapshot) });
    if (response.status === 412) throw conflictError();
    if (!response.ok) throw new Error('Drive upload failed (' + response.status + ').');
    await response.json();
    const verified = await readRemote();
    if (!verified || signature(verified.data) !== signature(snapshot)) throw conflictError();
    await finishSync(snapshot);
  }
  function scheduleUpload() {
    queued(async () => {
      syncing = true;
      try { await uploadDrive(); } catch (error) { await recordSyncError(error); }
      finally { syncing = false; }
    }).catch(() => console.info('Drive sync remains pending.'));
  }
  async function synchronize(action = 'sync') {
    validation.validateSyncAction(action);
    syncing = true;
    let previousBackupId;
    try {
      await loadLocal();
      previousBackupId = syncMeta?.lastBackupId;
      if (action === 'reconnect') {
        await DriveAuth.signOut(); await Preferences.remove({ key: 'fino-active-account' }); authSession = null; activeEmail = ''; fileId = null; data = undefined; localHistory = []; syncMeta = null; connected = false; authorizationRequired = true;
      } else if (action === 'backup') {
        await backupLocal(clone(data), 'manual');
        connected = true;
        syncMeta.error = null;
        await persistSyncMeta();
      } else if (action === 'upload') await uploadDrive(true);
      else {
        const remote = await readRemote();
        if (action === 'download') {
          if (!remote) throw new Error('fino-data.json was not found on Google Drive.');
          await backupLocal(clone(data), 'before download');
          await adoptRemote(remote.data);
        } else if (syncMeta.pendingUpload) {
          await uploadDrive();
        } else if (remote) await adoptRemote(remote.data);
        else await uploadDrive();
      }
    } catch (error) { await recordSyncError(error); throw error; }
    finally { syncing = false; }
    const status = statusSnapshot();
    return { success: true, action, savedLocally: status.savedLocally, savedRemotely: status.savedRemotely, backupSaved: Boolean(syncMeta?.lastBackupId && syncMeta.lastBackupId !== previousBackupId), status };
  }
  async function mutate(operation) {
    return queued(async () => {
      await loadLocal();
      const draft = clone(data);
      let result;
      try { result = operation(draft); } catch (cause) { throw cause.code ? cause : new errors.ValidationError({ message: cause.message, cause }); }
      const previous = data;
      const previousMeta = clone(syncMeta);
      data = draft;
      try { await saveLocal(); } catch (error) { data = previous; syncMeta = previousMeta; throw error; }
      scheduleUpload();
      const response = clone(result);
      if (response && typeof response === 'object') Object.defineProperty(response, 'persistence', { value: statusSnapshot(), enumerable: false });
      return response;
    });
  }

  async function proxy(action, parameters = {}) {
    window.FinoStateModel.validateJson(parameters);
    for (const key of Object.keys(parameters)) if (!['symbol', 'interval', 'outputsize', 'startDate', 'endDate'].includes(key)) throw new errors.ValidationError({ message: 'Unsupported market parameter.' });
    for (const key of ['startDate', 'endDate']) if (parameters[key] && !window.FinoStateModel.isDate(parameters[key])) throw new errors.ValidationError({ message: 'A valid calendar date is required.' });
    if (parameters.startDate && parameters.endDate && parameters.startDate > parameters.endDate) throw new errors.ValidationError({ message: 'The date range is reversed.' });
    if (parameters.outputsize != null && (!Number.isInteger(Number(parameters.outputsize)) || Number(parameters.outputsize) < 1 || Number(parameters.outputsize) > 5000)) throw new errors.ValidationError({ message: 'Invalid output size.' });
    if (!proxyConfig.proxyUrl || !proxyConfig.proxyToken) throw new Error("The market-data proxy is not configured in this APK.");
    const response = await fetch(proxyConfig.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: proxyConfig.proxyToken, action, ...parameters }),
    }, { timeoutMs: action === 'policyRate' ? window.FinoMarketModel.policyTimeoutMs : 10000 });
    const payload = await response.json();
    if (!payload?.ok) throw new errors.RemoteUnavailableError({ message: 'Market-data proxy request failed.' });
    window.FinoStateModel.validateJson(payload.data);
    if (['twelve', 'fred'].includes(action)) return window.FinoMarketModel.history(payload.data);
    return payload.data;
  }

  function normalizeOfficialDate(value) {
    const text = String(value || "");
    if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    const match = text.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : text.slice(0, 10);
  }

  function parseOfficialCsv(text) {
    const rows = []; let row = []; let field = ""; let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) { row.push(field); field = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
      } else field += char;
    }
    row.push(field); if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  async function mobileMacroeconomics() {
    const now = new Date();
    const start = new Date(now.getFullYear() - 3, 0, 1);
    const dateToken = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const nbuBase = "https://bank.gov.ua/NBUStatService/v1/statdirectory";
    const result = {
      updatedAt: new Date().toISOString(),
      sources: { nbu: "NBU", gdp: "State Statistics Service of Ukraine" },
      errors: {}, exchangeRates: [],
      inflation: { annual: [], monthly: [] },
      gdp: { nominal: [], realIndex: [] },
    };

    try {
      const [ratesResponse, inflationResponse] = await Promise.all([
        fetch(`${nbuBase}/exchange?json`, {}, { timeoutMs: window.FinoMarketModel.macroTimeoutMs }),
        fetch(`${nbuBase}/inflation?period=m&start=${dateToken(start)}&end=${dateToken(now)}&json`, {}, { timeoutMs: window.FinoMarketModel.macroTimeoutMs }),
      ]);
      if (!ratesResponse.ok || !inflationResponse.ok) throw new Error("NBU data is temporarily unavailable.");
      const [rates, inflation] = await Promise.all([ratesResponse.json(), inflationResponse.json()]);
      const wanted = new Set(["USD", "EUR", "GBP"]);
      result.exchangeRates = rates.filter((row) => wanted.has(String(row.cc || "").toUpperCase())).map((row) => ({
        code: row.cc, name: row.txten || row.txt, rate: Number(row.rate), date: normalizeOfficialDate(row.exchangedate),
      }));
      const national = inflation.filter((row) => row.mcrd081 === "Total" && (row.ku == null || row.ku === ""));
      const point = (row) => {
        let value = Number(row.value);
        if (String(row.dt || "").startsWith("201907") && value <= -90) value += 100;
        return { date: normalizeOfficialDate(row.dt), value };
      };
      const valid = (item) => item.date && Number.isFinite(item.value);
      const pick = (idValue, measure) => national.filter((row) => row.id_api === idValue && row.tzep === measure).map(point).filter(valid);
      result.inflation.annual = pick("prices_price_cpi_", "PCCM_");
      result.inflation.monthly = pick("prices_price_cpi_", "PCPM_");
    } catch (error) { result.errors.nbu = error.message || "Could not load NBU data."; }

    try {
      const response = await fetch(window.FinoMarketModel.gdpUrl, { headers: { Accept: "text/csv" } }, { timeoutMs: window.FinoMarketModel.macroTimeoutMs });
      if (!response.ok) throw new Error(`State Statistics Service returned ${response.status}.`);
      result.gdp = window.FinoMarketModel.gdp(await response.text());
    } catch (error) { result.errors.gdp = error.message || "Could not load GDP data."; }

    if (!result.exchangeRates.length && !Object.values(result.inflation).some((series) => series.length) && !result.gdp.nominal.length) {
      throw new Error("Official macroeconomic data is temporarily unavailable.");
    }
    return result;
  }

  let policyRateCache = null;
  let policyRatePending = null;
  async function mobileNbuPolicyRate() {
    if (policyRateCache && Date.now() - policyRateCache.updatedAt < 6 * 60 * 60 * 1000) return { policyRate: clone(policyRateCache.data) };
    if (!policyRatePending) policyRatePending = loadMobilePolicyRate().finally(() => { policyRatePending = null; });
    return policyRatePending;
  }
  async function loadMobilePolicyRate() {
    if (proxyConfig.proxyUrl && proxyConfig.proxyToken) {
      try {
        const result = await proxy("policyRate");
        const data = window.FinoMarketModel.policyRate(result?.policyRate, { normalized: true });
        policyRateCache = { data, updatedAt: Date.now() };
        return { policyRate: clone(data) };
      } catch (_) { /* Older proxy deployments fall back to the official NBU API. */ }
    }
    const now = new Date();
    const start = new Date(now.getFullYear() - 3, 0, 1);
    const dateToken = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const response = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/key?period=d&start=${dateToken(start)}&end=${dateToken(now)}&json`, {}, { timeoutMs: window.FinoMarketModel.policyTimeoutMs });
    if (!response.ok) throw new Error("NBU policy-rate data is temporarily unavailable.");
    const data = window.FinoMarketModel.policyRate(await response.json());
    policyRateCache = { data, updatedAt: Date.now() };
    return { policyRate: clone(data) };
  }

  async function mobileMarketCurrencies() {
    const response = await fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json");
    if (!response.ok) throw new Error(`NBU API returned ${response.status}.`);
    const payload = window.FinoMarketModel.nbuRates(await response.json());
    const excluded = new Set(["UAH", "XAU", "XAG", "XPT", "XPD"]);
    const currencies = (Array.isArray(payload) ? payload : []).filter((item) => {
      const code = String(item.cc || "").toUpperCase();
      return /^[A-Z]{3}$/.test(code) && !excluded.has(code);
    }).map((item) => ({ code: String(item.cc).toUpperCase(), name: item.txten || item.txt, rate: Number(item.rate), exchangeDate: item.exchangedate }));
    return { source: "NBU", currencies };
  }

  async function mobileCurrencyHistory(parameters = {}) {
    validation.validateQuery(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)])));
    const code = String(parameters.code || "").trim().toUpperCase();
    const startDate = String(parameters.startDate || "").slice(0, 10);
    const endDate = String(parameters.endDate || "").slice(0, 10);
    if (!/^[A-Z]{3}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("A valid currency and date range are required.");
    const compact = (value) => value.replaceAll("-", "");
    const query = new URLSearchParams({ start: compact(startDate), end: compact(endDate), valcode: code, sort: "exchangedate", order: "asc", json: "" });
    const response = await fetch(`https://bank.gov.ua/NBU_Exchange/exchange_site?${query}`);
    if (!response.ok) throw new Error(`NBU API returned ${response.status}.`);
    const payload = await response.json();
    const values = (Array.isArray(payload) ? payload : []).map((item) => {
      const [day, month, year] = String(item.exchangedate || "").split(".");
      const close = Number(item.rate_per_unit ?? item.rate);
      return { datetime: year && month && day ? `${year}-${month}-${day}` : item.exchangedate, open: close, high: close, low: close, close, volume: null };
    }).filter((item) => item.datetime && Number.isFinite(item.close));
    if (!values.length) throw new Error(`No NBU rates found for ${code}.`);
    return { provider: "NBU", meta: { symbol: `${code}/UAH`, currency: "UAH", interval: "1day", type: "Official exchange rate", exchange: "NBU", currencyCode: code }, values, cached: false, fetchedAt: new Date().toISOString() };
  }

  async function mobileFrankfurterHistory(parameters = {}) {
    validation.validateQuery(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)])));
    const ticker = String(parameters.ticker || "USEU").trim().toUpperCase();
    const pairs = { USEU: { base: "USD", quote: "EUR" }, EUUS: { base: "EUR", quote: "USD" } };
    const pair = pairs[ticker];
    if (!pair) throw new Error("Unsupported Frankfurter market ticker.");
    const query = new URLSearchParams({ base: pair.base, quotes: pair.quote, from: parameters.startDate, to: parameters.endDate });
    const response = await fetch(`https://api.frankfurter.dev/v2/rates?${query}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new errors.RemoteUnavailableError({ message: 'Frankfurter is temporarily unavailable.' });
    const values = (Array.isArray(payload) ? payload : []).filter((item) => item.base === pair.base && item.quote === pair.quote && Number.isFinite(Number(item.rate))).map((item) => ({ datetime: item.date, open: Number(item.rate), high: Number(item.rate), low: Number(item.rate), close: Number(item.rate), volume: null })).sort((a, b) => a.datetime.localeCompare(b.datetime));
    if (!values.length) throw new Error(`No ${pair.base}/${pair.quote} rates were found for this period.`);
    return { provider: "Frankfurter", meta: { symbol: `${pair.base}/${pair.quote}`, currency: pair.quote, interval: "1day", type: "Exchange rate", exchange: "Frankfurter", marketTicker: ticker }, values, cached: false, fetchedAt: new Date().toISOString() };
  }

  window.mobileApi = {
    isNative: true,
    async waitForSync() {
      let pending;
      do { pending = operationQueue; await pending; } while (pending !== operationQueue);
      return statusSnapshot();
    },
    async getData({ sync = true } = {}) {
      return queued(async () => {
        await loadLocal();
        if (sync) try { await synchronize(); } catch (_) { /* Status retains the error; local data remains available. */ }
        return clone(data);
      });
    },
    async getGoogleDriveStatus() {
      if (syncMeta) return statusSnapshot();
      return queued(async () => {
        try { await loadLocal(); } catch (error) { await recordSyncError(error); }
        return statusSnapshot();
      });
    },
    async syncGoogleDrive(action = 'sync') { return queued(() => synchronize(action)); },
    async getMarketTimeSeries(parameters) { return proxy("twelve", parameters); },
    async getMarketCurrencies() { return mobileMarketCurrencies(); },
    async getCurrencyHistory(parameters) { return mobileCurrencyHistory(parameters); },
    async getFrankfurterHistory(parameters) { return mobileFrankfurterHistory(parameters); },
    async getIndexHistory(parameters) { return proxy("fred", parameters); },
    async getMacroeconomics() { return mobileMacroeconomics(); },
    async getNbuPolicyRate() { return mobileNbuPolicyRate(); },
    async getBinanceEquityPrice(symbol) { return proxy("binance", { symbol }); },
    async syncApiAssets() {
      const snapshot = await queued(async () => { await loadLocal(); return { data: clone(data), email: activeEmail }; });
      const stagedData = clone(snapshot.data);
      const synced = [];
      const skipped = [];
      const binanceSynced = [];
      const binanceSkipped = [];
      const fundSlugs = { inzhur_reit: "inzhur-reit", inzhur_miltech: "inzhur-miltech" };

      try {
        const catalogResponse = await fetch("https://www.inzhur.reit/_api/assets", { headers: { Accept: "application/json" } });
        if (!catalogResponse.ok) throw new Error(`Inzhur API returned ${catalogResponse.status}.`);
        const catalogPayload = await catalogResponse.json();
        if (!Array.isArray(catalogPayload)) throw new Error("Inzhur API returned an invalid response.");
        const catalog = window.FinoMarketModel.inzhurCatalog(catalogPayload);
        const today = new Date().toISOString().slice(0, 10);
        for (const asset of stagedData.assets.filter((item) => ["ovdp", "inzhur_reit", "inzhur_miltech"].includes(item.type))) {
          let remoteAsset;
          if (asset.type === "ovdp") {
            const isin = String(asset.isin || "").trim().toUpperCase();
            remoteAsset = catalog.find((item) => item.type === "bond" && String(item.isin || "").trim().toUpperCase() === isin);
          } else {
            const slug = asset.inzhurSlug || fundSlugs[asset.type];
            remoteAsset = catalog.find((item) => item.type === "fund" && item.slug === slug);
          }
          if (!remoteAsset) { skipped.push({ id: asset.id, name: asset.name }); continue; }

          const currentPrice = Number(remoteAsset.prices?.sellUAH || remoteAsset.prices?.buyUAH || remoteAsset.prices?.buy || 0);
          if (currentPrice > 0) asset.currentPrice = currentPrice;
          asset.inzhurSlug = remoteAsset.slug;
          asset.lastSyncedAt = new Date().toISOString();
          if (currentPrice > 0) recordAssetPrice(stagedData, asset, "sync", asset.lastSyncedAt);

          if (asset.type === "ovdp") {
            asset.maturityDate = remoteAsset.maturityDate || asset.maturityDate;
            const maturityDate = String(asset.maturityDate || "").slice(0, 10);
            const schedule = (remoteAsset.paymentSchedule || []).map((payment) => {
              const amountPerUnit = Number(payment.amount || 0) / 100;
              const date = String(payment.date || "").slice(0, 10);
              return { date, amountPerUnit, type: date === maturityDate && amountPerUnit >= 500 ? "MATURITY" : "COUPON" };
            }).filter((payment) => /^\d{4}-\d{2}-\d{2}$/.test(payment.date) && payment.date >= today && payment.amountPerUnit > 0);
            asset.coupons = schedule.filter((payment) => payment.type === "COUPON").map(({ date, amountPerUnit }) => ({ date, amountPerUnit }));
            const maturity = schedule.find((payment) => payment.type === "MATURITY");
            if (maturity) asset.redemptionValue = maturity.amountPerUnit;
            stagedData.payments = (stagedData.payments || []).filter((payment) => payment.assetId !== asset.id || ["received", "paid"].includes(payment.status) || !["COUPON", "MATURITY"].includes(payment.type));
            schedule.forEach((payment) => stagedData.payments.push({
              id: id("payment"), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name,
              date: payment.date, type: payment.type, amountPerUnit: payment.amountPerUnit,
              amount: payment.amountPerUnit * Number(asset.quantity || 0), currency: "UAH", status: "planned",
            }));
          }
          synced.push({ id: asset.id, name: asset.name, price: asset.currentPrice || null, paymentScheduleUpdated: asset.type === "ovdp" });
        }
      } catch (error) {
        stagedData.assets.filter((item) => ["ovdp", "inzhur_reit", "inzhur_miltech"].includes(item.type)).forEach((asset) => {
          skipped.push({ id: asset.id, name: asset.name, error: "INZHUR_API_ERROR", message: error.message });
        });
      }

      const symbolMap = { SPYB: "SPY", SMHB: "SMH", AAPLB: "AAPL" };
      const holdings = stagedData.assets.filter((asset) => {
        if (asset.type === "crypto_earn") return false;
        const code = String(asset.ticker || asset.symbol || asset.name || "").trim().toUpperCase();
        return String(asset.instrumentName || "").trim().toLowerCase() === "binance" || /^[A-Z0-9.-]+B$/.test(code);
      });
      for (const asset of holdings) {
        const assetCode = String(asset.ticker || asset.symbol || asset.name || "").trim().toUpperCase();
        const underlyingSymbol = symbolMap[assetCode] || assetCode.replace(/B$/, "");
        try {
          const series = await proxy("twelve", { symbol: underlyingSymbol, interval: "1day", outputsize: 1 });
          const latest = series.values?.[series.values.length - 1];
          if (!(Number(latest?.close) > 0)) throw new Error("No current market price is available.");
          asset.currentPrice = Number(latest.close);
          asset.currency = "USD";
          asset.provider = "twelve-data";
          asset.lastPriceUpdate = series.fetchedAt || new Date().toISOString();
          recordAssetPrice(stagedData, asset, "sync", asset.lastPriceUpdate);
          binanceSynced.push({ id: asset.id, name: asset.name, symbol: assetCode, underlyingSymbol, price: asset.currentPrice, currency: "USD" });
        } catch (error) {
          binanceSkipped.push({ id: asset.id, name: asset.name, symbol: assetCode, error: "TWELVE_DATA_ERROR", message: error.message });
        }
      }
      if (!synced.length && !binanceSynced.length) return { synced, skipped, binanceSynced, binanceSkipped };
      return mutate(state => {
        if (snapshot.email !== activeEmail) throw new Error('Google account changed during synchronization. Retry for the current account.');
        const accepted = new Set();
        for (const result of [...synced, ...binanceSynced]) {
          const original = snapshot.data.assets.find(asset => asset.id === result.id);
          const current = state.assets.find(asset => asset.id === result.id);
          const staged = stagedData.assets.find(asset => asset.id === result.id);
          if (!current || rules.identity(current) !== rules.identity(original)) {
            skipped.push({ id: result.id, name: result.name, error: 'ASSET_CHANGED' });
            continue;
          }
          for (const field of ['currentPrice', 'inzhurSlug', 'lastSyncedAt', 'maturityDate', 'coupons', 'redemptionValue', 'currency', 'provider', 'lastPriceUpdate']) {
            if (staged[field] !== undefined) current[field] = clone(staged[field]);
          }
          recordAssetPrice(state, current, 'sync', staged.lastSyncedAt || staged.lastPriceUpdate);
          rebuildPlannedPayments(state, current);
          accepted.add(result.id);
        }
        return { synced: synced.filter(item => accepted.has(item.id)), skipped, binanceSynced: binanceSynced.filter(item => accepted.has(item.id)), binanceSkipped };
      });
    },
    async createAsset(input) { return mutate(state => {
      const asset = { ...input, createdAt: new Date().toISOString(), id: id('asset'), dividendRecordRule: input.dividendRecordRule || 'previous_month_end' };
      if (asset.type === 'crypto_earn') asset.currentPrice = number(asset.currentPrice) || number(asset.purchasePrice);
      if (asset.type === 'novapay') asset.maturityAmountPerUnit = number(asset.maturityAmount) / number(asset.quantity);
      state.assets.push(asset);
      state.transactions.push({ id: id('tx'), createdAt: asset.createdAt, assetId: asset.id, assetName: asset.name, type: 'BUY', quantity: number(asset.quantity), purchasePrice: number(asset.purchasePrice), amount: number(asset.quantity) * number(asset.purchasePrice), currency: asset.currency || 'UAH', date: asset.purchaseDate });
      rules.updateHolding(state, asset);
      rebuildPlannedPayments(state, asset);
      return asset;
    }); },
    async updateAsset(assetId, patch) { return mutate(state => {
      const asset = state.assets.find(item => item.id === assetId);
      if (!asset) throw new Error('Asset not found.');
      validation.validateAssetInput({ ...asset, ...patch }, { partial: true });
      if (!rules.canEditPurchase(state, asset, patch)) throw new Error('Purchase history or currency cannot be rewritten after additional purchases or sales.');
      Object.assign(asset, patch, { id: assetId, updatedAt: new Date().toISOString() });
      if (asset.type === 'novapay' && patch.maturityAmount !== undefined) asset.maturityAmountPerUnit = number(asset.maturityAmount) / number(asset.quantity);
      for (const transaction of state.transactions || []) if (transaction.assetId === assetId) transaction.assetName = asset.name;
      rules.updateSinglePurchase(state, asset);
      if (patch.currentPrice !== undefined && number(asset.currentPrice) > 0) recordAssetPrice(state, asset, 'edit', asset.updatedAt);
      state.payments = state.payments.filter(payment => payment.assetId !== assetId || rules.received(payment));
      rules.updateHolding(state, asset);
      rebuildPlannedPayments(state, asset);
      return asset;
    }); },
    async mergeAssets(assetIds) { return mutate(state => {
      const ids = [...new Set(assetIds)];
      const assets = state.assets.filter(asset => ids.includes(asset.id));
      if (assets.length < 2) throw new Error('At least two holdings are required to merge.');
      if (assets.length !== ids.length) throw new Error('Asset not found.');
      const primary = assets[0];
      if (!assets.every(asset => rules.identity(asset) === rules.identity(primary))) throw new Error('Only matching holdings can be merged.');
      if (assets.some(asset => asset.closedAt || state.payments.some(p => p.assetId === asset.id && p.type === 'MATURITY' && rules.received(p)))) throw new Error('Closed or redeemed holdings cannot be merged.');
      assets.forEach(asset => rules.completeLegacyPurchases(state, asset, id));
      const removed = new Set(assets.slice(1).map(asset => asset.id));
      primary.quantity = assets.reduce((sum, asset) => sum + number(asset.quantity), 0);
      primary.purchaseDate = assets.map(asset => asset.purchaseDate).filter(Boolean).sort()[0] || primary.purchaseDate;
      primary.firstDividendDate = assets.map(asset => asset.firstDividendDate).filter(Boolean).sort()[0] || primary.firstDividendDate;
      for (const collection of ['transactions', 'sales', 'payments', 'calendarNotes', 'priceHistory']) state[collection] = (state[collection] || []).map(item => removed.has(item.assetId) ? { ...item, assetId: primary.id, assetName: primary.name } : item);
      state.assets = state.assets.filter(asset => !removed.has(asset.id));
      rules.updateHolding(state, primary);
      rebuildPlannedPayments(state, primary);
      return primary;
    }); },
    async buyMoreAsset(assetId, purchase) { return mutate((state) => {
      const asset = state.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error("Asset not found.");
      validation.validateQuantity(purchase.quantity, asset.type);
      validation.validateAssetCurrency(purchase, asset);
      const oldQty = number(asset.quantity), qty = number(purchase.quantity);
      // Canonical fields take precedence over legacy aliases, exactly as in validation.
      const price = number(purchase.purchasePrice ?? purchase.price);
      const date = purchase.purchaseDate ?? purchase.date;
      asset.quantity = oldQty + qty;
      state.transactions.push({ id: id("tx"), createdAt: new Date().toISOString(), assetId, assetName: asset.name, instrumentId: purchase.instrumentId || asset.instrumentId, type: "BUY", quantity: qty, purchasePrice: price, amount: qty * price, currency: purchase.currency || asset.currency || "UAH", date });
      rules.updateHolding(state, asset);
      rebuildPlannedPayments(state, asset);
      return asset;
    }); },
    async deleteAsset(assetId) { return mutate((state) => {
      if (!state.assets.some(item => item.id === assetId)) throw new Error("Asset not found.");
      state.assets = state.assets.filter(item => item.id !== assetId);
      for (const collection of ['transactions', 'payments', 'sales', 'calendarNotes', 'priceHistory']) {
        state[collection] = (state[collection] || []).filter(item => item.assetId !== assetId);
      }
      return { success: true };
    }); },
    async getSales() { return queued(async () => clone((await loadLocal()).sales || [])); },
    async createSale(sale) { return mutate((state) => {
      validation.validateRequest('sale', sale);
      const ids = [...new Set(Array.isArray(sale.assetIds) && sale.assetIds.length ? sale.assetIds : [sale.assetId])];
      const assets = state.assets.filter((item) => ids.includes(item.id)).sort((a, b) => String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || "")));
      if (!assets.length || assets.length !== ids.length) throw new Error("Asset not found.");
      if (assets.some((asset) => asset.type === 'novapay' || (asset.type === 'deposit' && !asset.earlyWithdrawal))) throw new Error('This asset cannot be withdrawn before maturity.');
      const reference = assets[0];
      validation.validateAssetCurrency(sale, reference);
      if (!assets.every((asset) => asset.type === reference.type && String(asset.name).trim().toLowerCase() === String(reference.name).trim().toLowerCase() && (asset.currency || 'UAH') === (reference.currency || 'UAH'))) throw new Error('Only matching holdings can be sold together.');
      if (!Number.isFinite(Number(sale.quantity)) || !Number.isFinite(Number(sale.sellPrice)) || Number(sale.sellPrice) < 0) throw new Error('Valid quantity and sell price are required.');
      if (!['stock', 'etf', 'crypto_earn'].includes(reference.type) && !Number.isInteger(Number(sale.quantity))) throw new Error('Quantity must be a whole number greater than zero.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sale.sellDate || '')) || Number.isNaN(new Date(sale.sellDate + 'T00:00:00Z').getTime())) throw new Error('Valid sell date is required.');
      let remaining = number(sale.quantity);
      const totalAvailable = assets.reduce((sum, asset) => sum + availableQuantity(state, asset, sale.sellDate), 0);
      if (remaining <= 0 || remaining > totalAvailable + QUANTITY_EPSILON) throw new Error("Not enough units available.");
      const created = [];
      for (const asset of assets) {
        if (remaining <= QUANTITY_EPSILON) break;
        const quantity = Math.min(remaining, availableQuantity(state, asset, sale.sellDate));
        if (quantity <= 0) continue;
        const sellPrice = number(sale.sellPrice);
        const purchasePrice = rules.holdingsAtDate(state, asset, sale.sellDate).averagePrice;
        const costBasis = quantity * purchasePrice;
        const saleProceeds = quantity * sellPrice;
        const profit = saleProceeds - costBasis;
        const roi = costBasis > 0 ? profit / costBasis * 100 : 0;
        const record = { ...sale, createdAt: new Date().toISOString(), costBasisMethod: "moving_average", assetIds: undefined, assetId: asset.id, assetName: asset.name, type: asset.type, quantity, currency: asset.currency || sale.currency || "UAH", purchasePrice, costBasis, saleProceeds, profit, roi, id: id("sale") };
        state.sales.push(record);
        state.transactions.push({ ...record, saleId: record.id, id: id("tx"), date: sale.sellDate, amount: saleProceeds, type: "SELL" });
        rules.updateHolding(state, asset);
        rules.refreshPayments(state, asset.id);
        created.push(record);
        remaining -= quantity;
      }
      return { sales: created, remainingQuantity: totalAvailable - number(sale.quantity) };
    }); },
    async getTransactions() { return queued(async () => clone((await loadLocal()).transactions || [])); },
    async getPayments() { return queued(async () => clone((await loadLocal()).payments || [])); },
    async markPaymentReceived(paymentId) { return mutate((state) => {
      const payment = state.payments.find((item) => item.id === paymentId);
      if (!payment) throw new Error("Payment not found.");
      if (payment.status === "received" || payment.status === "paid" || payment.received) return payment;
      const receivedNow = new Date();
      const receivedDate = `${receivedNow.getFullYear()}-${String(receivedNow.getMonth() + 1).padStart(2, "0")}-${String(receivedNow.getDate()).padStart(2, "0")}`;
      if (payment.type === 'MATURITY') payment.costBasis = rules.holdingsAtDate(state, payment.assetId).remainingCost;
      payment.status = "received";
      payment.received = true;
      payment.receivedAt = receivedNow.toISOString();
      payment.receivedDate = receivedDate;
      const asset = state.assets.find((item) => item.id === payment.assetId);
      if (payment.type === "MATURITY" && asset) asset.closedAt = payment.receivedAt;
      state.transactions.push({
        id: id("tx"), createdAt: payment.receivedAt, date: receivedDate,
        assetId: payment.assetId, assetName: payment.assetName, paymentId: payment.id,
        type: payment.type, quantity: null, amount: payment.amount, currency: payment.currency || "UAH",
      });
      return payment;
    }); },
    async getCalendarNotes() { return queued(async () => clone((await loadLocal()).calendarNotes || [])); },
    async createCalendarNote(note) { return mutate((state) => { const created = { ...note, id: id("note") }; state.calendarNotes.push(created); return created; }); },
    async saveWallet(wallet) { return mutate((state) => { state.wallet = clone(wallet); return state.wallet; }); },
  };
  // Validate before entering the mutation queue; failed raw input never touches local state.
  for (const [method, check] of Object.entries({
    createAsset: asset => validation.validateAssetInput(asset),
    updateAsset: (_id, patch) => validation.validateRequest('patch', patch),
    buyMoreAsset: (_id, purchase) => validation.validateRequest('buy', { ...purchase, purchasePrice: purchase.purchasePrice ?? purchase.price, purchaseDate: purchase.purchaseDate ?? purchase.date }),
    createCalendarNote: note => validation.validateRequest('note', note),
    saveWallet: wallet => validation.validateWallet(wallet),
    syncGoogleDrive: (action = 'sync') => validation.validateSyncAction(action),
    mergeAssets: assetIds => validation.validateRequest('merge', { assetIds }),
  })) {
    const operation = window.mobileApi[method];
    window.mobileApi[method] = async function (...args) { check(...args); return operation.apply(this, args); };
  }
})();
