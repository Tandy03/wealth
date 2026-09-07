(function () {
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) return;

  const FILE_ID = "1FFYfJIenSPjVbZz2rcvJ9fWMMpXH1ZB7";
  const proxyConfig = window.FINO_MOBILE_CONFIG || {};
  const STORAGE_KEY = "fino-data-v1";
  const emptyData = () => ({
    sync: { revision: 0, updatedAt: new Date().toISOString(), deviceId: "android-phone" },
    assets: [], transactions: [], payments: [], calendarNotes: [], sales: [],
    wallet: { expenses: [], months: {}, loans: [] }, instruments: [],
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const Preferences = window.Capacitor.Plugins.Preferences;
  const DriveAuth = window.Capacitor.Plugins.GoogleDriveAuth;
  let data;
  let lastSyncAt = null;
  let syncing = false;

  async function loadLocal() {
    if (data) return data;
    const stored = await Preferences.get({ key: STORAGE_KEY });
    try { data = stored.value ? JSON.parse(stored.value) : emptyData(); }
    catch { data = emptyData(); }
    data.wallet ||= { expenses: [], months: {}, loans: [] };
    return data;
  }

  async function saveLocal() {
    data.sync = {
      revision: Number(data.sync?.revision || 0) + 1,
      updatedAt: new Date().toISOString(), deviceId: "android-phone",
    };
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) });
  }

  async function token() {
    const result = await DriveAuth.getAccessToken();
    if (!result?.accessToken) throw new Error("Google Drive authorization required.");
    return result.accessToken;
  }

  async function downloadDrive() {
    const accessToken = await token();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${FILE_ID}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Drive download failed (${response.status}).`);
    const remote = await response.json();
    if (!remote || !Array.isArray(remote.assets)) throw new Error("Drive file contains invalid data.");
    return remote;
  }

  async function uploadDrive(force = false) {
    await loadLocal();
    const accessToken = await token();
    if (!force) {
      const remote = await downloadDrive();
      if (Number(remote.sync?.revision || 0) > Number(data.sync?.revision || 0)) {
        throw new Error("Conflict detected: Google Drive contains newer data. Download it first.");
      }
    }
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${FILE_ID}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`Drive upload failed (${response.status}).`);
    lastSyncAt = new Date().toISOString();
  }

  async function mutate(operation) {
    await loadLocal();
    const result = operation(data);
    await saveLocal();
    uploadDrive().catch(() => {});
    return clone(result);
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

  window.mobileApi = {
    isNative: true,
    async getData() {
      await loadLocal();
      if (!data.assets.length && Number(data.sync?.revision || 0) === 0) {
        try { data = await downloadDrive(); await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) }); lastSyncAt = new Date().toISOString(); }
        catch (_) { /* Offline-first: retain the empty local snapshot. */ }
      }
      return clone(data);
    },
    async getGoogleDriveStatus() {
      await loadLocal();
      return { enabled: true, connected: true, syncing, lastSyncAt, status: syncing ? "Syncing" : "Synced", fileId: FILE_ID };
    },
    async syncGoogleDrive(action = "sync") {
      syncing = true;
      try {
        await loadLocal();
        if (action === "download") {
          const remote = await downloadDrive();
          data = remote;
          await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) });
        } else if (action === "upload") await uploadDrive(true);
        else if (action === "backup") await uploadDrive(false);
        else {
          const remote = await downloadDrive();
          if (Number(remote.sync?.revision || 0) > Number(data.sync?.revision || 0)) {
            data = remote;
            await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) });
          } else await uploadDrive(false);
        }
        lastSyncAt = new Date().toISOString();
        return { success: true, action, status: await this.getGoogleDriveStatus() };
      } finally { syncing = false; }
    },
    async getMarketTimeSeries(parameters) { return proxy("twelve", parameters); },
    async getIndexHistory(parameters) { return proxy("fred", parameters); },
    async getBinanceEquityPrice(symbol) { return proxy("binance", { symbol }); },
    async createAsset(asset) { return mutate((state) => { const created = { ...asset, id: id("asset") }; state.assets.push(created); state.transactions.push({ id: id("tx"), assetId: created.id, assetName: created.name, type: "BUY", quantity: Number(created.quantity || 0), price: Number(created.purchasePrice || 0), amount: Number(created.quantity || 0) * Number(created.purchasePrice || 0), currency: created.currency || "UAH", date: created.purchaseDate }); return created; }); },
    async updateAsset(assetId, patch) { return mutate((state) => { const asset = state.assets.find((item) => item.id === assetId); if (!asset) throw new Error("Asset not found."); Object.assign(asset, patch, { id: assetId }); return asset; }); },
    async mergeAssets(assetIds) { return mutate((state) => { const items = state.assets.filter((item) => assetIds.includes(item.id)); if (items.length < 2) throw new Error("At least two holdings are required to merge."); const primary = items[0]; primary.quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0); state.assets = state.assets.filter((item) => !assetIds.slice(1).includes(item.id)); state.transactions.forEach((tx) => { if (assetIds.includes(tx.assetId)) tx.assetId = primary.id; }); return primary; }); },
    async buyMoreAsset(assetId, purchase) { return mutate((state) => { const asset = state.assets.find((item) => item.id === assetId); if (!asset) throw new Error("Asset not found."); const oldQty = Number(asset.quantity || 0), qty = Number(purchase.quantity || 0), price = Number(purchase.price ?? purchase.purchasePrice ?? 0); asset.purchasePrice = oldQty + qty ? ((oldQty * Number(asset.purchasePrice || 0)) + qty * price) / (oldQty + qty) : price; asset.quantity = oldQty + qty; state.transactions.push({ id: id("tx"), assetId, assetName: asset.name, instrumentId: purchase.instrumentId || asset.instrumentId, type: "BUY", quantity: qty, price, amount: qty * price, currency: purchase.currency || asset.currency || "UAH", date: purchase.date || purchase.purchaseDate }); return asset; }); },
    async deleteAsset(assetId) { return mutate((state) => { state.assets = state.assets.filter((item) => item.id !== assetId); state.transactions = state.transactions.filter((item) => item.assetId !== assetId); state.payments = state.payments.filter((item) => item.assetId !== assetId); return { success: true }; }); },
    async getSales() { return clone((await loadLocal()).sales || []); },
    async createSale(sale) { return mutate((state) => { const asset = state.assets.find((item) => item.id === sale.assetId); if (!asset) throw new Error("Asset not found."); const quantity = Number(sale.quantity || 0); if (quantity > Number(asset.quantity || 0)) throw new Error("Not enough units available."); asset.quantity = Number(asset.quantity || 0) - quantity; const created = { ...sale, id: id("sale") }; state.sales.push(created); state.transactions.push({ ...created, id: id("tx"), type: "SELL", assetName: asset.name }); return created; }); },
    async getTransactions() { return clone((await loadLocal()).transactions || []); },
    async getPayments() { return clone((await loadLocal()).payments || []); },
    async markPaymentReceived(paymentId) { return mutate((state) => { const payment = state.payments.find((item) => item.id === paymentId); if (!payment) throw new Error("Payment not found."); payment.received = true; payment.receivedAt = new Date().toISOString(); return payment; }); },
    async getCalendarNotes() { return clone((await loadLocal()).calendarNotes || []); },
    async createCalendarNote(note) { return mutate((state) => { const created = { ...note, id: id("note") }; state.calendarNotes.push(created); return created; }); },
    async saveWallet(wallet) { return mutate((state) => { state.wallet = clone(wallet); return state.wallet; }); },
  };
})();
