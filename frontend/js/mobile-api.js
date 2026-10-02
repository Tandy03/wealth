(function () {
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) return;

  const proxyConfig = window.FINO_MOBILE_CONFIG || {};
  const validation = window.FinoValidation;
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
  const availableQuantity = (state, asset) => {
    if (asset.closedAt || (asset.type === "ovdp" && (state.payments || []).some((payment) => payment.assetId === asset.id && payment.type === "MATURITY" && isReceived(payment)))) return 0;
    if (asset.type !== "crypto_earn") return Math.max(0, number(asset.quantity) - soldQuantity(state, asset.id));
    const rate = Math.max(0, number(asset.annualRate)) / 100;
    const today = new Date(`${dateString(new Date())}T00:00:00Z`).getTime();
    const purchases = (state.transactions || []).filter((tx) => tx.assetId === asset.id && tx.type === "BUY" && tx.date);
    const sources = purchases.length ? purchases : [{ date: asset.purchaseDate, quantity: asset.quantity }];
    const accrued = sources.reduce((sum, source) => {
      const started = new Date(`${source.date}T00:00:00Z`).getTime();
      const days = Number.isFinite(started) ? Math.max(0, Math.floor((today - started) / MILLISECONDS_PER_DAY)) : 0;
      return sum + number(source.quantity) * ((1 + rate / DAYS_PER_YEAR) ** days);
    }, 0);
    const removed = (state.sales || []).filter((sale) => sale.assetId === asset.id && sale.sellDate).reduce((sum, sale) => {
      const soldAt = new Date(`${sale.sellDate}T00:00:00Z`).getTime();
      const days = Number.isFinite(soldAt) ? Math.max(0, Math.floor((today - soldAt) / MILLISECONDS_PER_DAY)) : 0;
      return sum + number(sale.quantity) * ((1 + rate / DAYS_PER_YEAR) ** days);
    }, 0);
    return Math.max(0, accrued - removed);
  };
  const isReceived = (payment) => payment.status === "received" || payment.status === "paid" || payment.received;
  const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  function purchasedQuantityOnDate(state, assetId, targetDate) {
    return (state.transactions || [])
      .filter((tx) => tx.assetId === assetId && tx.type === "BUY" && tx.date && tx.date <= targetDate)
      .reduce((sum, tx) => sum + number(tx.quantity), 0);
  }

  function eligibleDividendQuantity(state, asset, paymentDate) {
    const payment = new Date(`${paymentDate}T00:00:00`);
    const cutoff = new Date(payment.getFullYear(), payment.getMonth(), 0);
    return Math.min(number(asset.quantity), purchasedQuantityOnDate(state, asset.id, dateString(cutoff)));
  }

  function repairLegacyPurchaseHistory(state) {
    (state.assets || []).forEach((asset) => {
      const buys = (state.transactions || []).filter((tx) => tx.assetId === asset.id && tx.type === "BUY");
      const excess = buys.reduce((sum, tx) => sum + number(tx.quantity), 0) - number(asset.quantity);
      if (excess <= 1e-8 || !buys.length) return;
      const earliest = [...buys].sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)))[0];
      const correctedQuantity = number(earliest.quantity) - excess;
      if (correctedQuantity <= 0) return;
      const otherCost = buys.filter((tx) => tx !== earliest).reduce((sum, tx) => sum + number(tx.amount), 0);
      const correctedCost = Math.max(0, number(asset.quantity) * number(asset.purchasePrice) - otherCost);
      earliest.quantity = correctedQuantity;
      earliest.amount = correctedCost;
      earliest.purchasePrice = correctedCost / correctedQuantity;
      delete earliest.price;
    });
  }

  function refreshPlannedPaymentAmounts(state) {
    (state.payments || []).forEach((payment) => {
      if (isReceived(payment)) return;
      const asset = (state.assets || []).find((item) => item.id === payment.assetId);
      if (!asset) return;
      if (payment.type === "DIVIDEND") payment.amount = number(payment.amountPerUnit) * eligibleDividendQuantity(state, asset, payment.date);
      if (payment.type === "COUPON") payment.amount = number(payment.amountPerUnit) * purchasedQuantityOnDate(state, asset.id, payment.date);
    });
  }

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

  function rebuildPlannedPayments(state, asset) {
    state.payments = (state.payments || []).filter((payment) => payment.assetId !== asset.id || isReceived(payment));
    const add = (payment) => {
      const alreadyReceived = state.payments.some((existing) =>
        existing.assetId === asset.id && existing.type === payment.type &&
        existing.date === payment.date && isReceived(existing));
      if (!alreadyReceived) state.payments.push({
        id: id("payment"), createdAt: new Date().toISOString(), assetId: asset.id,
        assetName: asset.name, currency: asset.currency || "UAH", status: "planned", ...payment,
      });
    };

    if (["inzhur_reit", "s1_reit"].includes(asset.type) && asset.firstDividendDate) {
      const start = new Date(`${asset.firstDividendDate}T00:00:00`);
      for (let index = 0; index < 24; index += 1) {
        const paymentDate = new Date(start.getFullYear(), start.getMonth() + index, 10);
        if (paymentDate < start) continue;
        const date = dateString(paymentDate);
        const amountPerUnit = number(asset.dividendPerUnit);
        add({ date, type: "DIVIDEND", amountPerUnit, amount: amountPerUnit * eligibleDividendQuantity(state, asset, date) });
      }
    } else if (asset.type === "ovdp") {
      (asset.coupons || []).forEach((coupon) => add({
        date: coupon.date, type: "COUPON", amountPerUnit: number(coupon.amountPerUnit),
        amount: number(coupon.amountPerUnit) * purchasedQuantityOnDate(state, asset.id, coupon.date),
      }));
      if (asset.maturityDate) add({
        date: asset.maturityDate, type: "MATURITY", amountPerUnit: number(asset.redemptionValue) || DEFAULT_BOND_REDEMPTION,
        amount: (number(asset.redemptionValue) || DEFAULT_BOND_REDEMPTION) * number(asset.quantity),
      });
    }
  }
  const Preferences = window.Capacitor.Plugins.Preferences;
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
      if (!allowOffline) throw error;
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
    authSession = { accessToken: result.accessToken, email };
    return authSession;
  }

  async function loadLocal() {
    await ensureAccount(true);
    if (data) return data;
    const stored = await Preferences.get({ key: storageKey });
    let loaded;
    try { loaded = validateSnapshot(stored.value ? JSON.parse(stored.value) : emptyData()); }
    catch { throw new Error('Local portfolio data is corrupted. Restore a backup before making changes.'); }
    const baseline = stored.value ? signature(loaded) : null;
    normalizeData(loaded);
    const savedMeta = await Preferences.get({ key: metadataKey() });
    let metadata;
    try { metadata = savedMeta.value ? JSON.parse(savedMeta.value) : null; } catch { metadata = null; }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof metadata.pendingUpload !== 'boolean' || !(metadata.baseline === null || typeof metadata.baseline === 'string')) metadata = null;
    syncMeta = metadata || { baseline, pendingUpload: Boolean(stored.value), conflict: false, error: null, lastSyncAt: null };
    data = loaded;
    return data;
  }

  async function saveLocal() {
    validateSnapshot(data);
    data.sync = {
      revision: Number(data.sync?.revision || 0) + 1,
      updatedAt: new Date().toISOString(), deviceId: "android-phone",
    };
    syncMeta.pendingUpload = true;
    await persistSyncMeta();
    await Preferences.set({ key: storageKey, value: JSON.stringify(data) });
  }

  async function token() {
    return (await ensureAccount()).accessToken;
  }

  async function rememberFileId(idValue) {
    fileId = idValue;
    await Preferences.set({ key: `fino-drive-file:${accountSuffix(activeEmail)}`, value: idValue });
  }

  async function locateDriveFile(accessToken) {
    if (fileId) {
      const check = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (check.ok && !(await check.json()).trashed) return fileId;
      fileId = null;
    }
    const query = new URLSearchParams({
      q: "name = 'fino-data.json' and trashed = false",
      spaces: "drive", orderBy: "modifiedTime desc", pageSize: "10", fields: "files(id,name,modifiedTime,appProperties)",
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Drive file lookup failed (${response.status}).`);
    const found = (await response.json()).files?.[0]?.id;
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
  function signature(value) {
    const canonical = (item) => Array.isArray(item) ? item.map(canonical)
      : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])])) : item;
    return JSON.stringify(canonical(value));
  }
  async function persistSyncMeta() {
    await Preferences.set({ key: metadataKey(), value: JSON.stringify(syncMeta) });
  }
  async function recordSyncError(error) {
    connected = error.code === 'SYNC_CONFLICT';
    authorizationRequired = error.code === 'AUTHORIZATION_REQUIRED';
    if (syncMeta) {
      syncMeta.error = error.message || 'Google Drive synchronization failed.';
      syncMeta.conflict = error.code === 'SYNC_CONFLICT';
      await persistSyncMeta();
    }
  }
  function conflictError() {
    const error = new Error('Conflict detected: both the local portfolio and Google Drive have changes. Choose Download or Upload to resolve it; a backup will be saved first.');
    error.code = 'SYNC_CONFLICT';
    return error;
  }
  function statusSnapshot() {
    return { enabled: true, connected, authorizationRequired, syncing, pendingUpload: Boolean(syncMeta?.pendingUpload), conflict: Boolean(syncMeta?.conflict), error: syncMeta?.error || null,
      lastSyncAt: syncMeta?.lastSyncAt || null, fileId, email: activeEmail,
      status: syncing ? 'Syncing' : syncMeta?.conflict ? 'Conflict detected' : syncMeta?.error ? 'Offline — changes saved locally' : syncMeta?.pendingUpload ? 'Pending upload' : connected ? 'Synced' : 'Offline — changes saved locally' };
  }
  async function finishSync(snapshot) {
    syncMeta = { baseline: signature(snapshot), pendingUpload: false, conflict: false, error: null, lastSyncAt: new Date().toISOString() };
    connected = true;
    authorizationRequired = false;
    await persistSyncMeta();
  }
  async function readRemote(allowInvalid = false) {
    const accessToken = await token();
    const currentFileId = await locateDriveFile(accessToken);
    if (!currentFileId) return null;
    const metadata = await fetch('https://www.googleapis.com/drive/v3/files/' + currentFileId + '?fields=id,version,md5Checksum', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!metadata.ok) throw new Error('Drive metadata lookup failed (' + metadata.status + ').');
    const response = await fetch('https://www.googleapis.com/drive/v3/files/' + currentFileId + '?alt=media', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!response.ok) throw new Error('Drive download failed (' + response.status + ').');
    let raw;
    let remote;
    try {
      raw = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
      remote = validateSnapshot(JSON.parse(raw));
    } catch (error) {
      if (!allowInvalid) throw new Error('Drive file contains invalid data. Local data was preserved; use Upload to replace it after a backup.');
      return { data: null, contentSignature: raw || '', etag: metadata.headers?.get?.('etag') || null, valid: false };
    }
    return { data: remote, contentSignature: signature(remote), etag: metadata.headers?.get?.('etag') || null, valid: true };
  }

  async function backupFolder(accessToken) {
    const query = new URLSearchParams({ q: "name = 'fino-backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: 'files(id)', pageSize: '1' });
    const found = await fetch('https://www.googleapis.com/drive/v3/files?' + query, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!found.ok) throw new Error('Drive backup folder lookup failed (' + found.status + ').');
    const folderId = (await found.json()).files?.[0]?.id;
    if (folderId) return folderId;
    const created = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fino-backups', mimeType: 'application/vnd.google-apps.folder' }) });
    if (!created.ok) throw new Error('Drive backup folder creation failed (' + created.status + ').');
    return (await created.json()).id;
  }
  async function backupLocal(snapshot, reason) {
    // Keep a recovery copy on the device even if the cloud backup fails.
    await Preferences.set({ key: 'fino-recovery:' + accountSuffix(activeEmail) + ':' + Date.now(), value: JSON.stringify(snapshot) });
    const accessToken = await token();
    const folderId = await backupFolder(accessToken);
    return createJsonFile(accessToken, { name: 'fino-data-' + Date.now() + '-' + id('backup') + '.json', mimeType: 'application/json', parents: [folderId], description: 'fino ' + reason + ' backup' }, snapshot);
  }

  async function backupRemote(accessToken, remoteId) {
    const folderId = await backupFolder(accessToken);
    const response = await fetch('https://www.googleapis.com/drive/v3/files/' + remoteId + '/copy?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'fino-data-' + Date.now() + '-' + id('backup') + '.json', parents: [folderId], description: 'fino backup before replacement' }) });
    if (!response.ok) throw new Error('Drive remote backup failed (' + response.status + ').');
  }
  async function adoptRemote(remote) {
    const next = normalizeData(clone(remote));
    await Preferences.set({ key: storageKey, value: JSON.stringify(next) });
    data = next;
    await finishSync(remote);
  }
  async function uploadDrive(force = false) {
    await loadLocal();
    const snapshot = clone(data);
    const remote = await readRemote(force);
    if (!force && remote && signature(remote.data) !== syncMeta.baseline && signature(remote.data) !== signature(snapshot)) throw conflictError();
    if (!force && !remote && syncMeta.baseline && syncMeta.pendingUpload) throw conflictError();
    if (remote && signature(remote.data) === signature(snapshot)) { await finishSync(snapshot); return; }
    const accessToken = await token();
    if (remote) {
      await backupRemote(accessToken, fileId);
      const checked = await readRemote(force);
      if (!checked || checked.contentSignature !== remote.contentSignature) throw conflictError();
      remote.etag = checked.etag;
    }
    if (!fileId) { await createDriveFile(accessToken, snapshot); await finishSync(snapshot); return; }
    const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
    if (remote?.etag) headers['If-Match'] = remote.etag;
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', { method: 'PATCH', headers, body: JSON.stringify(snapshot) });
    if (response.status === 412) throw conflictError();
    if (!response.ok) throw new Error('Drive upload failed (' + response.status + ').');
    await finishSync(snapshot);
  }
  function scheduleUpload() {
    queued(async () => {
      syncing = true;
      try { await uploadDrive(); } catch (error) { await recordSyncError(error); }
      finally { syncing = false; }
    }).catch((error) => console.error('Could not persist Drive sync status:', error.message));
  }
  async function synchronize(action = 'sync') {
    syncing = true;
    try {
      await loadLocal();
      if (action === 'reconnect') {
        await DriveAuth.signOut(); await Preferences.remove({ key: 'fino-active-account' }); authSession = null; activeEmail = ''; fileId = null; data = undefined; syncMeta = null; connected = false; authorizationRequired = true;
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
    return { success: true, action, status: statusSnapshot() };
  }
  async function mutate(operation) {
    return queued(async () => {
      await loadLocal();
      const draft = clone(data);
      const result = operation(draft);
      const previous = data;
      data = draft;
      try { await saveLocal(); } catch (error) { data = previous; throw error; }
      scheduleUpload();
      return clone(result);
    });
  }

  async function proxy(action, parameters = {}) {
    if (!proxyConfig.proxyUrl || !proxyConfig.proxyToken) throw new Error("The market-data proxy is not configured in this APK.");
    const response = await fetch(proxyConfig.proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: proxyConfig.proxyToken, action, ...parameters }),
    });
    const payload = await response.json();
    if (!payload?.ok) throw new Error(payload?.error?.message || "Market-data proxy request failed.");
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
        fetch(`${nbuBase}/exchange?json`),
        fetch(`${nbuBase}/inflation?period=m&start=${dateToken(start)}&end=${dateToken(now)}&json`),
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
      const gdpUrl = "https://stat.gov.ua/sdmx/workspaces/default:integration/registry/sdmx/3.0/data/dataflow/SSSU/DF_ANNUAL_NATIONAL_ACCOUNTS/latest/*?startPeriod=2010";
      const response = await fetch(gdpUrl, { headers: { Accept: "text/csv" } });
      if (!response.ok) throw new Error(`State Statistics Service returned ${response.status}.`);
      const rows = parseOfficialCsv((await response.text()).replace(/^\uFEFF/, ""));
      const headers = rows.shift() || [];
      const objects = rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index]])));
      const select = (priceType) => objects.filter((row) => row.INDICATOR === "GDP_CUR_PRC" && row.PRICE_TYPE === priceType && row.REGION === "UA00000000000000000" && row.BREAKDOWN_CATEGORY === "_T" && row.BREAKDOWN === "_T" && row.SECTOR_ECONOMY === "S_1" && row.FREQ === "A").map((row) => ({ date: row.TIME_PERIOD, value: Number(row.OBS_VALUE) })).filter((item) => item.date && Number.isFinite(item.value));
      result.gdp.nominal = select("CURR_PRICES");
      result.gdp.realIndex = select("IDX_VOL_PY");
    } catch (error) { result.errors.gdp = error.message || "Could not load GDP data."; }

    if (!result.exchangeRates.length && !Object.values(result.inflation).some((series) => series.length) && !result.gdp.nominal.length) {
      throw new Error("Official macroeconomic data is temporarily unavailable.");
    }
    return result;
  }

  let policyRateCache = null;
  async function mobileNbuPolicyRate() {
    if (policyRateCache) return { policyRate: clone(policyRateCache) };
    if (proxyConfig.proxyUrl && proxyConfig.proxyToken) {
      try {
        const result = await proxy("policyRate");
        policyRateCache = result?.policyRate || [];
        if (policyRateCache.length) return { policyRate: clone(policyRateCache) };
      } catch (_) { /* Older proxy deployments fall back to the official NBU API. */ }
    }
    const now = new Date();
    const start = new Date(now.getFullYear() - 8, 0, 1);
    const dateToken = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const response = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/key?period=d&start=${dateToken(start)}&end=${dateToken(now)}&json`);
    if (!response.ok) throw new Error("NBU policy-rate data is temporarily unavailable.");
    policyRateCache = (await response.json()).filter((row) => row.id_api === "KEY_PolicyRate").map((row) => ({ date: normalizeOfficialDate(row.dt), value: Number(row.value) })).filter((item) => item.date && Number.isFinite(item.value)).sort((a, b) => a.date.localeCompare(b.date));
    return { policyRate: clone(policyRateCache) };
  }

  async function mobileMarketCurrencies() {
    const response = await fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json");
    if (!response.ok) throw new Error(`NBU API returned ${response.status}.`);
    const payload = await response.json();
    const excluded = new Set(["UAH", "XAU", "XAG", "XPT", "XPD"]);
    const currencies = (Array.isArray(payload) ? payload : []).filter((item) => {
      const code = String(item.cc || "").toUpperCase();
      return /^[A-Z]{3}$/.test(code) && !excluded.has(code);
    }).map((item) => ({ code: String(item.cc).toUpperCase(), name: item.txten || item.txt, rate: Number(item.rate), exchangeDate: item.exchangedate }));
    return { source: "NBU", currencies };
  }

  async function mobileCurrencyHistory(parameters = {}) {
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
    const ticker = String(parameters.ticker || "USEU").trim().toUpperCase();
    const pairs = { USEU: { base: "USD", quote: "EUR" }, EUUS: { base: "EUR", quote: "USD" } };
    const pair = pairs[ticker];
    if (!pair) throw new Error("Unsupported Frankfurter market ticker.");
    const query = new URLSearchParams({ base: pair.base, quotes: pair.quote, from: parameters.startDate, to: parameters.endDate });
    const response = await fetch(`https://api.frankfurter.dev/v2/rates?${query}`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || `Frankfurter API returned ${response.status}.`);
    const values = (Array.isArray(payload) ? payload : []).filter((item) => item.base === pair.base && item.quote === pair.quote && Number.isFinite(Number(item.rate))).map((item) => ({ datetime: item.date, open: Number(item.rate), high: Number(item.rate), low: Number(item.rate), close: Number(item.rate), volume: null })).sort((a, b) => a.datetime.localeCompare(b.datetime));
    if (!values.length) throw new Error(`No ${pair.base}/${pair.quote} rates were found for this period.`);
    return { provider: "Frankfurter", meta: { symbol: `${pair.base}/${pair.quote}`, currency: pair.quote, interval: "1day", type: "Exchange rate", exchange: "Frankfurter", marketTicker: ticker }, values, cached: false, fetchedAt: new Date().toISOString() };
  }

  window.mobileApi = {
    isNative: true,
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
      return queued(async () => {
      await loadLocal();
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
        const catalog = catalogPayload.map((item) => ({
          id: item.id, slug: item.slug, type: item.type, status: item.status, title: item.title,
          isin: item.assetDetails?.isin || null,
          maturityDate: item.assetDetails?.maturityDate || null,
          prices: item.assetDetails?.prices || null,
          paymentSchedule: item.assetDetails?.paymentSchedule || [],
        }));
        const today = new Date().toISOString().slice(0, 10);
        for (const asset of data.assets.filter((item) => ["ovdp", "inzhur_reit", "inzhur_miltech"].includes(item.type))) {
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
          if (currentPrice > 0) recordAssetPrice(data, asset, "sync", asset.lastSyncedAt);

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
            data.payments = (data.payments || []).filter((payment) => payment.assetId !== asset.id || ["received", "paid"].includes(payment.status) || !["COUPON", "MATURITY"].includes(payment.type));
            schedule.forEach((payment) => data.payments.push({
              id: id("payment"), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name,
              date: payment.date, type: payment.type, amountPerUnit: payment.amountPerUnit,
              amount: payment.amountPerUnit * Number(asset.quantity || 0), currency: "UAH", status: "planned",
            }));
          }
          synced.push({ id: asset.id, name: asset.name, price: asset.currentPrice || null, paymentScheduleUpdated: asset.type === "ovdp" });
        }
      } catch (error) {
        data.assets.filter((item) => ["ovdp", "inzhur_reit", "inzhur_miltech"].includes(item.type)).forEach((asset) => {
          skipped.push({ id: asset.id, name: asset.name, error: "INZHUR_API_ERROR", message: error.message });
        });
      }

      const symbolMap = { SPYB: "SPY", SMHB: "SMH", AAPLB: "AAPL" };
      const holdings = data.assets.filter((asset) => {
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
          recordAssetPrice(data, asset, "sync", asset.lastPriceUpdate);
          binanceSynced.push({ id: asset.id, name: asset.name, symbol: assetCode, underlyingSymbol, price: asset.currentPrice, currency: "USD" });
        } catch (error) {
          binanceSkipped.push({ id: asset.id, name: asset.name, symbol: assetCode, error: "TWELVE_DATA_ERROR", message: error.message });
        }
      }
      if (synced.length || binanceSynced.length) {
        await saveLocal();
        scheduleUpload();
      }
      return { synced, skipped, binanceSynced, binanceSkipped };
      });
    },
    async createAsset(asset) { return mutate((state) => { const created = { ...asset, id: id("asset") }; state.assets.push(created); state.transactions.push({ id: id("tx"), assetId: created.id, assetName: created.name, type: "BUY", quantity: number(created.quantity), purchasePrice: number(created.purchasePrice), amount: number(created.quantity) * number(created.purchasePrice), currency: created.currency || "UAH", date: created.purchaseDate }); rebuildPlannedPayments(state, created); return created; }); },
    async updateAsset(assetId, patch) { return mutate((state) => { const asset = state.assets.find((item) => item.id === assetId); if (!asset) throw new Error("Asset not found."); validation.validateAssetInput({ ...asset, ...patch }, { partial: true }); Object.assign(asset, patch, { id: assetId, updatedAt: new Date().toISOString() }); (state.transactions || []).forEach((tx) => { if (tx.assetId === assetId) { tx.assetName = asset.name; tx.currency = asset.currency || tx.currency; } }); if (patch.currentPrice !== undefined && number(asset.currentPrice) > 0) recordAssetPrice(state, asset, "edit", asset.updatedAt); rebuildPlannedPayments(state, asset); return asset; }); },
    async mergeAssets(assetIds) { return mutate((state) => { const ids = [...new Set(assetIds)]; const items = state.assets.filter((item) => ids.includes(item.id)); if (items.length < 2) throw new Error("At least two holdings are required to merge."); if (items.length !== ids.length) throw new Error('Asset not found.'); const primary = items[0]; if (!items.every(item => item.type === primary.type && String(item.name).trim().toLowerCase() === String(primary.name).trim().toLowerCase() && (item.currency || 'UAH') === (primary.currency || 'UAH'))) throw new Error('Only matching holdings can be merged.'); const removedIds = new Set(items.slice(1).map((item) => item.id)); const totalQuantity = items.reduce((sum, item) => sum + number(item.quantity), 0); const totalCost = items.reduce((sum, item) => sum + number(item.quantity) * number(item.purchasePrice), 0); primary.quantity = totalQuantity; primary.purchasePrice = totalQuantity ? totalCost / totalQuantity : 0; primary.purchaseDate = items.map((item) => item.purchaseDate).filter(Boolean).sort()[0] || primary.purchaseDate; primary.firstDividendDate = items.map((item) => item.firstDividendDate).filter(Boolean).sort()[0] || primary.firstDividendDate; const reassign = (values = []) => values.map((item) => removedIds.has(item.assetId) ? { ...item, assetId: primary.id, assetName: primary.name } : item); state.transactions = reassign(state.transactions); state.sales = reassign(state.sales); state.payments = reassign(state.payments); state.calendarNotes = reassign(state.calendarNotes); state.priceHistory = reassign(state.priceHistory); state.assets = state.assets.filter((item) => !removedIds.has(item.id)); rebuildPlannedPayments(state, primary); return primary; }); },
    async buyMoreAsset(assetId, purchase) { return mutate((state) => {
      const asset = state.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error("Asset not found.");
      validation.validateQuantity(purchase.quantity, asset.type);
      validation.validateAssetCurrency(purchase, asset);
      const oldQty = number(asset.quantity), qty = number(purchase.quantity);
      // Canonical fields take precedence over legacy aliases, exactly as in validation.
      const price = number(purchase.purchasePrice ?? purchase.price);
      const date = purchase.purchaseDate ?? purchase.date;
      asset.purchasePrice = ((oldQty * number(asset.purchasePrice)) + qty * price) / (oldQty + qty);
      asset.quantity = oldQty + qty;
      state.transactions.push({ id: id("tx"), assetId, assetName: asset.name, instrumentId: purchase.instrumentId || asset.instrumentId, type: "BUY", quantity: qty, purchasePrice: price, amount: qty * price, currency: purchase.currency || asset.currency || "UAH", date });
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
      const totalAvailable = assets.reduce((sum, asset) => sum + availableQuantity(state, asset), 0);
      if (remaining <= 0 || remaining > totalAvailable + QUANTITY_EPSILON) throw new Error("Not enough units available.");
      const created = [];
      for (const asset of assets) {
        if (remaining <= QUANTITY_EPSILON) break;
        const quantity = Math.min(remaining, availableQuantity(state, asset));
        if (quantity <= 0) continue;
        const sellPrice = number(sale.sellPrice);
        const costBasis = quantity * number(asset.purchasePrice);
        const saleProceeds = quantity * sellPrice;
        const profit = saleProceeds - costBasis;
        const roi = costBasis > 0 ? profit / costBasis * 100 : 0;
        const record = { ...sale, assetIds: undefined, assetId: asset.id, assetName: asset.name, type: asset.type, quantity, currency: asset.currency || sale.currency || "UAH", costBasis, saleProceeds, profit, roi, id: id("sale") };
        state.sales.push(record);
        state.transactions.push({ ...record, id: id("tx"), date: sale.sellDate, amount: saleProceeds, type: "SELL" });
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
