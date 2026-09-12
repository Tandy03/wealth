(function () {
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) return;

  const FILE_ID = "1FFYfJIenSPjVbZz2rcvJ9fWMMpXH1ZB7";
  const proxyConfig = window.FINO_MOBILE_CONFIG || {};
  const STORAGE_KEY = "fino-data-v1";
  const emptyData = () => ({
    sync: { revision: 0, updatedAt: new Date().toISOString(), deviceId: "android-phone" },
    assets: [], transactions: [], payments: [], calendarNotes: [], sales: [], priceHistory: [],
    wallet: { expenses: [], months: {}, loans: [] }, instruments: [],
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const number = (value) => Number(value || 0);
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

  function normalizeData(state) {
    state.wallet ||= { expenses: [], months: {}, loans: [] };
    state.priceHistory = Array.isArray(state.priceHistory) ? state.priceHistory : [];
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
        date: asset.maturityDate, type: "MATURITY", amountPerUnit: number(asset.redemptionValue) || 1000,
        amount: (number(asset.redemptionValue) || 1000) * number(asset.quantity),
      });
    }
  }
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
    normalizeData(data);
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

  function isRemoteNewer(remote, local) {
    const remoteRevision = number(remote?.sync?.revision);
    const localRevision = number(local?.sync?.revision);
    if (remoteRevision !== localRevision) return remoteRevision > localRevision;
    return String(remote?.sync?.updatedAt || "") > String(local?.sync?.updatedAt || "");
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

  function normalizeOfficialDate(value) {
    const text = String(value || "");
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
    const start = new Date(now.getFullYear() - 8, 0, 1);
    const dateToken = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const nbuBase = "https://bank.gov.ua/NBUStatService/v1/statdirectory";
    const result = {
      updatedAt: new Date().toISOString(),
      sources: { nbu: "NBU", gdp: "State Statistics Service of Ukraine" },
      errors: {}, exchangeRates: [],
      inflation: { annual: [], monthly: [], core: [], ppi: [] },
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
      result.inflation.core = pick("prices_price_ci_", "PCCM_");
      result.inflation.ppi = national.filter((row) => row.id_api === "prices_price_ppi_" && row.tzep === "PCCM_" && row.mcrk110 === "BCDE").map(point).filter(valid);
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
    async getData() {
      await loadLocal();
      try {
        const remote = await downloadDrive();
        if (isRemoteNewer(remote, data) || (!data.assets.length && number(data.sync?.revision) === 0)) {
          data = normalizeData(remote);
          await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) });
        }
        lastSyncAt = new Date().toISOString();
      } catch (_) { /* Offline-first: retain the local snapshot. */ }
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
          data = normalizeData(remote);
          await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) });
        } else if (action === "upload") await uploadDrive(true);
        else if (action === "backup") await uploadDrive(false);
        else {
          const remote = await downloadDrive();
          if (isRemoteNewer(remote, data)) {
            data = normalizeData(remote);
            await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) });
          } else await uploadDrive(false);
        }
        lastSyncAt = new Date().toISOString();
        return { success: true, action, status: await this.getGoogleDriveStatus() };
      } finally { syncing = false; }
    },
    async getMarketTimeSeries(parameters) { return proxy("twelve", parameters); },
    async getMarketCurrencies() { return mobileMarketCurrencies(); },
    async getCurrencyHistory(parameters) { return mobileCurrencyHistory(parameters); },
    async getFrankfurterHistory(parameters) { return mobileFrankfurterHistory(parameters); },
    async getIndexHistory(parameters) { return proxy("fred", parameters); },
    async getMacroeconomics() { return mobileMacroeconomics(); },
    async getBinanceEquityPrice(symbol) { return proxy("binance", { symbol }); },
    async syncApiAssets() {
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
        uploadDrive().catch(() => {});
      }
      return { synced, skipped, binanceSynced, binanceSkipped };
    },
    async createAsset(asset) { return mutate((state) => { const created = { ...asset, id: id("asset") }; state.assets.push(created); state.transactions.push({ id: id("tx"), assetId: created.id, assetName: created.name, type: "BUY", quantity: number(created.quantity), purchasePrice: number(created.purchasePrice), amount: number(created.quantity) * number(created.purchasePrice), currency: created.currency || "UAH", date: created.purchaseDate }); rebuildPlannedPayments(state, created); return created; }); },
    async updateAsset(assetId, patch) { return mutate((state) => { const asset = state.assets.find((item) => item.id === assetId); if (!asset) throw new Error("Asset not found."); Object.assign(asset, patch, { id: assetId, updatedAt: new Date().toISOString() }); (state.transactions || []).forEach((tx) => { if (tx.assetId === assetId) { tx.assetName = asset.name; tx.currency = asset.currency || tx.currency; } }); if (patch.currentPrice !== undefined && number(asset.currentPrice) > 0) recordAssetPrice(state, asset, "edit", asset.updatedAt); rebuildPlannedPayments(state, asset); return asset; }); },
    async mergeAssets(assetIds) { return mutate((state) => { const ids = [...new Set(assetIds)]; const items = state.assets.filter((item) => ids.includes(item.id)); if (items.length < 2) throw new Error("At least two holdings are required to merge."); const primary = items[0]; const removedIds = new Set(items.slice(1).map((item) => item.id)); const totalQuantity = items.reduce((sum, item) => sum + number(item.quantity), 0); const totalCost = items.reduce((sum, item) => sum + number(item.quantity) * number(item.purchasePrice), 0); primary.quantity = totalQuantity; primary.purchasePrice = totalQuantity ? totalCost / totalQuantity : 0; primary.purchaseDate = items.map((item) => item.purchaseDate).filter(Boolean).sort()[0] || primary.purchaseDate; primary.firstDividendDate = items.map((item) => item.firstDividendDate).filter(Boolean).sort()[0] || primary.firstDividendDate; const reassign = (values = []) => values.map((item) => removedIds.has(item.assetId) ? { ...item, assetId: primary.id, assetName: primary.name } : item); state.transactions = reassign(state.transactions); state.sales = reassign(state.sales); state.payments = reassign(state.payments); state.calendarNotes = reassign(state.calendarNotes); state.priceHistory = reassign(state.priceHistory); state.assets = state.assets.filter((item) => !removedIds.has(item.id)); rebuildPlannedPayments(state, primary); return primary; }); },
    async buyMoreAsset(assetId, purchase) { return mutate((state) => { const asset = state.assets.find((item) => item.id === assetId); if (!asset) throw new Error("Asset not found."); const oldQty = number(asset.quantity), qty = number(purchase.quantity), price = number(purchase.price ?? purchase.purchasePrice); asset.purchasePrice = oldQty + qty ? ((oldQty * number(asset.purchasePrice)) + qty * price) / (oldQty + qty) : price; asset.quantity = oldQty + qty; state.transactions.push({ id: id("tx"), assetId, assetName: asset.name, instrumentId: purchase.instrumentId || asset.instrumentId, type: "BUY", quantity: qty, purchasePrice: price, amount: qty * price, currency: purchase.currency || asset.currency || "UAH", date: purchase.date || purchase.purchaseDate }); rebuildPlannedPayments(state, asset); return asset; }); },
    async deleteAsset(assetId) { return mutate((state) => { state.assets = state.assets.filter((item) => item.id !== assetId); state.transactions = state.transactions.filter((item) => item.assetId !== assetId); state.payments = state.payments.filter((item) => item.assetId !== assetId); state.priceHistory = (state.priceHistory || []).filter((item) => item.assetId !== assetId); return { success: true }; }); },
    async getSales() { return clone((await loadLocal()).sales || []); },
    async createSale(sale) { return mutate((state) => { const asset = state.assets.find((item) => item.id === sale.assetId); if (!asset) throw new Error("Asset not found."); const quantity = Number(sale.quantity || 0); if (quantity > Number(asset.quantity || 0)) throw new Error("Not enough units available."); asset.quantity = Number(asset.quantity || 0) - quantity; const created = { ...sale, id: id("sale") }; state.sales.push(created); state.transactions.push({ ...created, id: id("tx"), type: "SELL", assetName: asset.name }); return created; }); },
    async getTransactions() { return clone((await loadLocal()).transactions || []); },
    async getPayments() { return clone((await loadLocal()).payments || []); },
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
      state.transactions.push({
        id: id("tx"), createdAt: payment.receivedAt, date: receivedDate,
        assetId: payment.assetId, assetName: payment.assetName, paymentId: payment.id,
        type: payment.type, quantity: null, amount: payment.amount, currency: payment.currency || "UAH",
      });
      return payment;
    }); },
    async getCalendarNotes() { return clone((await loadLocal()).calendarNotes || []); },
    async createCalendarNote(note) { return mutate((state) => { const created = { ...note, id: id("note") }; state.calendarNotes.push(created); return created; }); },
    async saveWallet(wallet) { return mutate((state) => { state.wallet = clone(wallet); return state.wallet; }); },
  };
})();
