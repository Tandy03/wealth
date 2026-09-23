const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs/promises");
const os = require("node:os");
require("./config/loadEnv");
const { getTokenizedEquityPrice } = require("./services/binance/equityMarket");
const { getTimeSeries } = require("./services/twelveData/client");
const { getNbuCurrencyHistory } = require("./services/nbu/exchangeHistory");
const { getExchangeHistory: getFrankfurterExchangeHistory } = require("./services/frankfurter/exchangeHistory");
const { getIndexHistory } = require("./services/fred/indices");
const { getMacroeconomics, getPolicyRate } = require("./services/macroeconomics/client");
const googleDriveStorage = require("./services/googleDrive/storage");

const app = express();

const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, "data", "data.json");

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const BASE_CURRENCY = "UAH";
const SUPPORTED_CURRENCIES = new Set(["UAH", "USD", "EUR"]);

function normalizeCurrency(value) {
  const currency = String(value || BASE_CURRENCY).toUpperCase();
  return SUPPORTED_CURRENCIES.has(currency) ? currency : BASE_CURRENCY;
}

const INZHUR_ASSETS_URL = "https://www.inzhur.reit/_api/assets";
const NBU_EXCHANGE_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
const INZHUR_CACHE_TTL_MS = 15 * 60 * 1000;
let inzhurAssetsCache = {
  updatedAt: 0,
  assets: null,
};
let nbuRatesCache = { updatedAt: 0, exchangeDate: null, rates: null };

/* Serialize each read-modify-write cycle for the shared JSON data file. */
let dataMutationQueue = Promise.resolve();
let storageInitializationPromise = null;

function serializeMutation(handler) {
  return (req, res, next) => {
    const operation = dataMutationQueue.then(
      () => handler(req, res, next),
      () => handler(req, res, next),
    );

    dataMutationQueue = operation.catch(() => {});
    operation.catch(next);
  };
}

/*
 * ==========================================================
 * MIDDLEWARE
 * ==========================================================
 */

app.use(cors());
// Wallet history is saved as one JSON document. Once enough expenses have
// accumulated it can legitimately exceed Express' 100 KB default limit.
app.use(express.json({ limit: "2mb" }));
app.use(express.static(FRONTEND_DIR));

/*
 * ==========================================================
 * DATA HELPERS
 * ==========================================================
 */

async function readData() {
  await initializeStorage();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");

    const data = JSON.parse(raw);

    if (!Array.isArray(data.assets)) {
      data.assets = [];
    }

    if (!Array.isArray(data.transactions)) {
      data.transactions = [];
    }

    if (!Array.isArray(data.payments)) {
      data.payments = [];
    }

    if (!Array.isArray(data.calendarNotes)) {
      data.calendarNotes = [];
    }

    if (!Array.isArray(data.sales)) {
      data.sales = [];
    }
    if (!Array.isArray(data.priceHistory)) {
      data.priceHistory = [];
    }

    if (!data.wallet || typeof data.wallet !== "object") {
      data.wallet = { expenses: [], months: {}, loans: [] };
    }
    if (!Array.isArray(data.wallet.expenses)) data.wallet.expenses = [];
    if (!data.wallet.months || typeof data.wallet.months !== "object") data.wallet.months = {};
    if (!Array.isArray(data.wallet.loans)) data.wallet.loans = [];
    if (!Array.isArray(data.instruments)) data.instruments = [];

    [
      data.assets,
      data.transactions,
      data.payments,
      data.calendarNotes,
      data.sales,
    ].forEach((collection) => {
      collection.forEach((item) => {
        item.currency = normalizeCurrency(item.currency);
      });
    });

    normalizeAssetNames(data);
    initializeAssetPriceHistory(data);
    repairLegacyPurchaseHistory(data);
    data.assets.forEach((asset) => updatePlannedPaymentsForAsset(data, asset.id));
    const assetIds = new Set(data.assets.map((asset) => asset.id));
    data.payments = data.payments.filter((payment) =>
      assetIds.has(payment.assetId) || payment.status === "received" || payment.status === "paid");

    return data;
  } catch (error) {
    /*
     * If data.json does not exist,
     * create an empty data structure.
     */

    if (error.code === "ENOENT") {
      const emptyData = {
        assets: [],
        transactions: [],
        payments: [],
        calendarNotes: [],
        sales: [],
        priceHistory: [],
        wallet: { expenses: [], months: {}, loans: [] },
        instruments: [],
      };

      await writeData(emptyData);

      return emptyData;
    }

    throw error;
  }
}

async function writeData(data) {
  const previousRevision = normalizeNumber(data.sync?.revision);
  data.sync = { revision: previousRevision + 1, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
  await writeLocalData(data);

  if (googleDriveStorage.isEnabled()) {
    // Do not keep API responses waiting on Google. The queue keeps only the
    // newest snapshot and serializes uploads in the background.
    googleDriveStorage.queueUpload(data);
  }
}

async function writeLocalData(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temporaryFile, DATA_FILE);
}

async function initializeStorage() {
  if (storageInitializationPromise) return storageInitializationPromise;
  storageInitializationPromise = (async () => {
    if (!googleDriveStorage.isEnabled()) return;
    let localData;
    try {
      localData = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      localData = { sync: { revision: 0, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() }, assets: [], transactions: [], payments: [], calendarNotes: [], sales: [], priceHistory: [], wallet: { expenses: [], months: {}, loans: [] }, instruments: [] };
    }
    if (!localData.sync || typeof localData.sync !== "object") localData.sync = { revision: 0, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
    try {
      const initialized = await googleDriveStorage.initialize(localData);
      const needsSyncMetadata = !initialized.data.sync || typeof initialized.data.sync !== "object";
      if (needsSyncMetadata) {
        initialized.data.sync = { revision: 1, updatedAt: new Date().toISOString(), deviceId: process.env.GOOGLE_DRIVE_DEVICE_ID || os.hostname() };
      }
      await writeLocalData(initialized.data);
      if (needsSyncMetadata) await googleDriveStorage.uploadData(initialized.data);
      console.log(`Data storage initialized from ${initialized.source}.`);
    } catch (error) {
      console.error(`Google Drive initialization failed; using local data: ${error.message}`);
      await writeLocalData(localData);
    }
  })();
  return storageInitializationPromise;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAssetNames(data) {
  const renamed = new Map();
  (data.assets || []).forEach((asset) => {
    if (String(asset.name || "").trim().toLowerCase() === "ovdp 1") {
      asset.name = "OVDP 5378";
      renamed.set(asset.id, asset.name);
    }
  });
  [data.transactions, data.payments, data.calendarNotes, data.sales, data.priceHistory].forEach((items = []) => {
    items.forEach((item) => { if (renamed.has(item.assetId)) item.assetName = renamed.get(item.assetId); });
  });
}

function recordAssetPrice(data, asset, source, recordedAt = new Date().toISOString()) {
  const price = normalizeNumber(asset.currentPrice);
  if (price <= 0 || !(data.assets || []).some((item) => item.id === asset.id)) return;
  data.priceHistory ||= [];
  data.priceHistory.push({
    id: createId("price"), assetId: asset.id, assetName: asset.name,
    recordedAt, date: recordedAt.slice(0, 10), price,
    currency: asset.currency || BASE_CURRENCY, source,
  });
}

function initializeAssetPriceHistory(data) {
  data.priceHistory ||= [];
  (data.assets || []).forEach((asset) => {
    if (normalizeNumber(asset.currentPrice) <= 0) return;
    if (data.priceHistory.some((point) => point.assetId === asset.id)) return;
    recordAssetPrice(data, asset, "initial", asset.lastSyncedAt || asset.updatedAt || asset.createdAt || new Date().toISOString());
  });
}

function isValidDateString(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);

  return !Number.isNaN(date.getTime());
}

function normalizeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function supportsFractionalQuantity(type) {
  return type === "etf" || type === "stock";
}

function isValidQuantity(value, type) {
  return value > 0 && (supportsFractionalQuantity(type) || Number.isInteger(value));
}

/*
 * ==========================================================
 * QUANTITY / SALES HELPERS
 * ==========================================================
 */

function getSoldQuantity(data, assetId) {
  return (data.sales || [])
    .filter((sale) => sale.assetId === assetId)
    .reduce((sum, sale) => sum + normalizeNumber(sale.quantity), 0);
}

function getAvailableQuantity(data, assetId) {
  const asset = data.assets.find((item) => item.id === assetId);

  if (!asset) {
    return 0;
  }

  const hasReceivedMaturity =
    asset.type === "ovdp" &&
    data.payments.some(
      (payment) =>
        payment.assetId === assetId &&
        payment.type === "MATURITY" &&
        (payment.status === "received" || payment.status === "paid"),
    );

  if (asset.closedAt || hasReceivedMaturity) {
    return 0;
  }

  const originalQuantity = normalizeNumber(asset.quantity);

  const soldQuantity = getSoldQuantity(data, assetId);

  return Math.max(0, originalQuantity - soldQuantity);
}

function getPurchasedQuantityOnDate(data, assetId, targetDate) {
  const target = new Date(`${targetDate}T23:59:59`);

  return (data.transactions || [])
    .filter(
      (transaction) =>
        transaction.assetId === assetId &&
        transaction.type === "BUY" &&
        transaction.date &&
        new Date(`${transaction.date}T00:00:00`) <= target,
    )
    .reduce(
      (sum, transaction) => sum + normalizeNumber(transaction.quantity),
      0,
    );
}

function getDividendEligibleQuantity(data, assetId, paymentDate) {
  const payment = new Date(`${paymentDate}T00:00:00`);
  const cutoff = new Date(payment.getFullYear(), payment.getMonth(), 0);
  const purchasedQuantity = getPurchasedQuantityOnDate(
    data,
    assetId,
    `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`,
  );
  const asset = data.assets.find((item) => item.id === assetId);
  return Math.min(purchasedQuantity, normalizeNumber(asset?.quantity));
}

function repairLegacyPurchaseHistory(data) {
  (data.assets || []).forEach((asset) => {
    const buys = (data.transactions || []).filter(
      (transaction) => transaction.assetId === asset.id && transaction.type === "BUY",
    );
    const excess = buys.reduce((sum, transaction) => sum + normalizeNumber(transaction.quantity), 0)
      - normalizeNumber(asset.quantity);
    if (excess <= 1e-8 || !buys.length) return;
    const earliest = [...buys].sort((a, b) =>
      String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)))[0];
    const correctedQuantity = normalizeNumber(earliest.quantity) - excess;
    if (correctedQuantity <= 0) return;
    const otherCost = buys.filter((transaction) => transaction !== earliest)
      .reduce((sum, transaction) => sum + normalizeNumber(transaction.amount), 0);
    const correctedCost = Math.max(
      0,
      normalizeNumber(asset.quantity) * normalizeNumber(asset.purchasePrice) - otherCost,
    );
    earliest.quantity = correctedQuantity;
    earliest.amount = correctedCost;
    earliest.purchasePrice = correctedCost / correctedQuantity;
    delete earliest.price;
  });
}

function updatePlannedPaymentsForAsset(data, assetId) {
  data.payments = data.payments.map((payment) => {
    if (payment.assetId !== assetId) {
      return payment;
    }

    /*
     * Never modify payments that
     * have already been received.
     */
    if (payment.status === "received" || payment.status === "paid") {
      return payment;
    }

    /*
     * Only coupons and dividends
     * depend on the number of units.
     */
    if (payment.type !== "COUPON" && payment.type !== "DIVIDEND") {
      return payment;
    }

    /*
     * Calculate the quantity that
     * existed on THIS payment date.
     *
     * This is important when the asset
     * was purchased in several portions.
     */
    const quantity = payment.type === "DIVIDEND"
      ? getDividendEligibleQuantity(data, assetId, payment.date)
      : getPurchasedQuantityOnDate(data, assetId, payment.date);

    const amountPerUnit = normalizeNumber(payment.amountPerUnit);

    return {
      ...payment,

      amount: amountPerUnit * quantity,
    };
  });
}

function hasReceivedPayment(data, assetId, type, date) {
  return data.payments.some((payment) =>
    payment.assetId === assetId && payment.type === type && payment.date === date &&
    (payment.status === "received" || payment.status === "paid"));
}

/*
 * ==========================================================
 * API - ALL DATA
 * ==========================================================
 */

app.get("/api/data", async (req, res) => {
  try {
    const data = await readData();

    res.json(data);
  } catch (error) {
    console.error("GET /api/data:", error);

    res.status(500).json({
      error: "Failed to read data.",
    });
  }
});

async function sendGoogleDriveStatus(req, res) {
  await initializeStorage();
  res.json(googleDriveStorage.getStatus());
}

app.get("/api/google-drive/status", sendGoogleDriveStatus);
app.get("/api/sync/status", sendGoogleDriveStatus);

const synchronizeGoogleDrive = serializeMutation(async (req, res) => {
  try {
    await initializeStorage();
    const action = req.body?.action || req.body?.direction || "sync";
    if (action === "download") {
      const localData = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
      const remoteData = await googleDriveStorage.downloadData();
      if (!remoteData) return res.status(404).json({ error: "fino-data.json was not found on Google Drive." });
      await googleDriveStorage.createManualBackup(localData);
      await writeLocalData(remoteData);
    } else if (action === "backup") {
      const localData = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
      await googleDriveStorage.createManualBackup(localData);
    } else if (action === "reconnect") {
      await googleDriveStorage.reconnect();
    } else {
      const localData = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
      await googleDriveStorage.uploadData(localData);
    }
    res.json({ success: true, action, status: googleDriveStorage.getStatus() });
  } catch (error) {
    console.error("POST /api/sync/google-drive:", error.message);
    res.status(502).json({ error: error.message, status: googleDriveStorage.getStatus() });
  }
});

app.post("/api/google-drive/sync", synchronizeGoogleDrive);
app.post("/api/sync/google-drive", synchronizeGoogleDrive);

app.get("/api/exchange-rates", async (req, res) => {
  try {
    const cacheIsFresh = nbuRatesCache.rates && Date.now() - nbuRatesCache.updatedAt < 60 * 60 * 1000;
    if (!cacheIsFresh) {
      const response = await fetch(NBU_EXCHANGE_URL, {
        headers: { Accept: "application/json", "User-Agent": "Wealth-Dashboard/1.0" },
      });
      if (!response.ok) throw new Error(`NBU API returned ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("NBU API returned an invalid payload.");
      const usd = payload.find((item) => String(item.cc).toUpperCase() === "USD");
      const eur = payload.find((item) => String(item.cc).toUpperCase() === "EUR");
      if (!usd || !eur || normalizeNumber(usd.rate) <= 0 || normalizeNumber(eur.rate) <= 0) {
        throw new Error("USD or EUR rate is missing from the NBU response.");
      }
      nbuRatesCache = {
        updatedAt: Date.now(),
        exchangeDate: usd.exchangedate || eur.exchangedate || null,
        rates: { UAH: 1, USD: normalizeNumber(usd.rate), EUR: normalizeNumber(eur.rate) },
      };
    }
    res.json({ ...nbuRatesCache, cached: cacheIsFresh, source: "NBU" });
  } catch (error) {
    console.error("GET /api/exchange-rates:", error);
    if (nbuRatesCache.rates) return res.json({ ...nbuRatesCache, cached: true, stale: true, source: "NBU" });
    res.status(502).json({ error: "Could not load exchange rates from the NBU." });
  }
});

app.get("/api/market-data/time-series", async (req, res) => {
  try {
    const result = await getTimeSeries({
      symbol: req.query.symbol,
      interval: req.query.interval,
      outputsize: req.query.outputsize,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.json(result);
  } catch (error) {
    console.error("GET /api/market-data/time-series:", error.code || error.message);
    res.status(error.status || 502).json({ error: error.message, code: error.code || "TWELVE_DATA_ERROR" });
  }
});

app.get("/api/market-data/currencies", async (req, res) => {
  try {
    const response = await fetch(NBU_EXCHANGE_URL, { headers: { Accept: "application/json", "User-Agent": "Wealth-Dashboard/1.0" } });
    if (!response.ok) throw new Error(`NBU API returned ${response.status}`);
    const payload = await response.json();
    const excluded = new Set(["UAH", "XAU", "XAG", "XPT", "XPD"]);
    const currencies = (Array.isArray(payload) ? payload : [])
      .filter((item) => /^[A-Z]{3}$/.test(String(item.cc || "")) && !excluded.has(String(item.cc).toUpperCase()))
      .map((item) => ({ code: String(item.cc).toUpperCase(), name: item.txt, rate: normalizeNumber(item.rate), exchangeDate: item.exchangedate }));
    res.json({ source: "NBU", currencies });
  } catch (error) {
    console.error("GET /api/market-data/currencies:", error.message);
    res.status(502).json({ error: "Could not load the NBU currency list." });
  }
});

app.get("/api/market-data/currency-history", async (req, res) => {
  try {
    res.json(await getNbuCurrencyHistory({ code: req.query.code, startDate: req.query.startDate, endDate: req.query.endDate }));
  } catch (error) {
    console.error("GET /api/market-data/currency-history:", error.message);
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get("/api/market-data/frankfurter-history", async (req, res) => {
  try {
    res.json(await getFrankfurterExchangeHistory({ ticker: req.query.ticker, startDate: req.query.startDate, endDate: req.query.endDate }));
  } catch (error) {
    console.error("GET /api/market-data/frankfurter-history:", error.message);
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get("/api/market-data/index-history", async (req, res) => {
  try {
    res.json(await getIndexHistory({ symbol: req.query.symbol, startDate: req.query.startDate, endDate: req.query.endDate }));
  } catch (error) {
    console.error("GET /api/market-data/index-history:", error.code || error.message);
    res.status(error.status || 502).json({ error: error.message, code: error.code || "FRED_API_ERROR" });
  }
});

app.get("/api/macroeconomics", async (req, res) => {
  try {
    res.json(await getMacroeconomics());
  } catch (error) {
    console.error("GET /api/macroeconomics:", error.message);
    res.status(502).json({ error: "Could not load macroeconomic data." });
  }
});

app.get("/api/macroeconomics/policy-rate", async (req, res) => {
  try {
    res.json({ policyRate: await getPolicyRate() });
  } catch (error) {
    console.error("GET /api/macroeconomics/policy-rate:", error.message);
    res.status(502).json({ error: "Could not load the NBU key policy rate." });
  }
});

/*
 * ==========================================================
 * API - INZHUR CATALOG
 *
 * The browser calls our backend instead of the remote domain.
 * This avoids CORS issues and limits remote requests with a cache.
 * ==========================================================
 */

app.get("/api/inzhur-assets", async (req, res) => {
  try {
    const cacheIsFresh =
      inzhurAssetsCache.assets &&
      Date.now() - inzhurAssetsCache.updatedAt < INZHUR_CACHE_TTL_MS;

    if (!cacheIsFresh) {
      const response = await fetch(INZHUR_ASSETS_URL, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Inzhur API returned ${response.status}`);
      }

      const payload = await response.json();

      if (!Array.isArray(payload)) {
        throw new Error("Inzhur API returned an invalid payload.");
      }

      inzhurAssetsCache = {
        updatedAt: Date.now(),
        assets: payload.map((asset) => ({
          id: asset.id,
          slug: asset.slug,
          type: asset.type,
          status: asset.status,
          title: asset.title,
          offerPage: asset.offerPage,
          isin: asset.assetDetails?.isin || null,
          maturityDate: asset.assetDetails?.maturityDate || null,
          prices: asset.assetDetails?.prices || null,
          returnRates: asset.assetDetails?.returnRates || null,
          paymentSchedule: asset.assetDetails?.paymentSchedule || [],
        })),
      };
    }

    res.json({
      updatedAt: new Date(inzhurAssetsCache.updatedAt).toISOString(),
      cached: cacheIsFresh,
      assets: inzhurAssetsCache.assets,
    });
  } catch (error) {
    console.error("GET /api/inzhur-assets:", error);
    res.status(502).json({
      error: "Could not load the Inzhur asset catalog.",
    });
  }
});

async function getInzhurCatalogAssets() {
  const cacheIsFresh =
    inzhurAssetsCache.assets &&
    Date.now() - inzhurAssetsCache.updatedAt < INZHUR_CACHE_TTL_MS;

  if (cacheIsFresh) {
    return inzhurAssetsCache.assets;
  }

  const response = await fetch(INZHUR_ASSETS_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Inzhur API returned ${response.status}`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("Inzhur API returned an invalid payload.");
  }

  inzhurAssetsCache = {
    updatedAt: Date.now(),
    assets: payload.map((asset) => ({
      id: asset.id,
      slug: asset.slug,
      type: asset.type,
      status: asset.status,
      title: asset.title,
      offerPage: asset.offerPage,
      isin: asset.assetDetails?.isin || null,
      maturityDate: asset.assetDetails?.maturityDate || null,
      prices: asset.assetDetails?.prices || null,
      returnRates: asset.assetDetails?.returnRates || null,
      paymentSchedule: asset.assetDetails?.paymentSchedule || [],
    })),
  };

  return inzhurAssetsCache.assets;
}

app.post("/api/assets/sync-inzhur", serializeMutation(async (req, res) => {
  try {
    const data = await readData();
    const catalog = await getInzhurCatalogAssets();
    const fundSlugs = {
      inzhur_reit: "inzhur-reit",
      inzhur_miltech: "inzhur-miltech",
    };
    const synced = [];
    const skipped = [];
    const binanceSynced = [];
    const binanceSkipped = [];

    data.assets.forEach((asset) => {
      if (!["ovdp", "inzhur_reit", "inzhur_miltech"].includes(asset.type)) return;
      let remoteAsset = null;

      if (asset.type === "ovdp") {
        const isin = String(asset.isin || "").trim().toUpperCase();
        remoteAsset = catalog.find(
          (item) => item.type === "bond" && item.isin === isin,
        );
      } else {
        const slug = asset.inzhurSlug || fundSlugs[asset.type];
        remoteAsset = catalog.find(
          (item) => item.type === "fund" && item.slug === slug,
        );
      }

      if (!remoteAsset) {
        skipped.push({ id: asset.id, name: asset.name });
        return;
      }

      const currentPrice = normalizeNumber(
        remoteAsset.prices?.sellUAH || remoteAsset.prices?.buyUAH || remoteAsset.prices?.buy,
      );

      if (currentPrice > 0) {
        asset.currentPrice = currentPrice;
      }

      asset.inzhurSlug = remoteAsset.slug;
      asset.lastSyncedAt = new Date().toISOString();
      if (currentPrice > 0) recordAssetPrice(data, asset, "sync", asset.lastSyncedAt);

      if (asset.type === "ovdp") {
        asset.maturityDate = remoteAsset.maturityDate || asset.maturityDate;
        const quantity = getAvailableQuantity(data, asset.id);
        const today = new Date().toISOString().slice(0, 10);
        const maturityDate = String(asset.maturityDate || "").slice(0, 10);
        const remoteSchedule = (remoteAsset.paymentSchedule || [])
          .map((payment) => {
            const amountPerUnit = normalizeNumber(payment.amount) / 100;
            const date = String(payment.date || "").slice(0, 10);
            const type = date === maturityDate && amountPerUnit >= 500 ? "MATURITY" : "COUPON";
            return { date, amountPerUnit, type };
          })
          .filter((payment) => isValidDateString(payment.date) && payment.date >= today && payment.amountPerUnit > 0);

        /* Keep the asset editor in sync with the authoritative API schedule. */
        asset.coupons = remoteSchedule
          .filter((payment) => payment.type === "COUPON")
          .map(({ date, amountPerUnit }) => ({ date, amountPerUnit }));

        const maturityPayment = remoteSchedule.find((payment) => payment.type === "MATURITY");
        if (maturityPayment) asset.redemptionValue = maturityPayment.amountPerUnit;

        data.payments = data.payments.filter(
          (payment) =>
            payment.assetId !== asset.id ||
            payment.status === "received" ||
            payment.status === "paid" ||
            !["COUPON", "MATURITY"].includes(payment.type),
        );

        remoteSchedule.forEach((payment) => {
          data.payments.push({
            id: createId("payment"),
            createdAt: new Date().toISOString(),
            assetId: asset.id,
            assetName: asset.name,
            date: payment.date,
            type: payment.type,
            amountPerUnit: payment.amountPerUnit,
            amount: payment.amountPerUnit * quantity,
            currency: BASE_CURRENCY,
            status: "planned",
          });
        });
      }

      synced.push({
        id: asset.id,
        name: asset.name,
        price: asset.currentPrice || null,
        paymentScheduleUpdated: asset.type === "ovdp",
      });
    });

    const binanceAssets = data.assets.filter((asset) => {
      if (!["stock", "etf"].includes(asset.type)) return false;
      const nameCode = String(asset.name || "").trim().toUpperCase();
      const code = /^[A-Z0-9.-]+B$/.test(nameCode) ? nameCode : String(asset.ticker || asset.symbol || nameCode).trim().toUpperCase();
      return String(asset.instrumentName || "").trim().toLowerCase() === "binance" || /^[A-Z0-9.-]+B$/.test(code);
    });

    for (const asset of binanceAssets) {
      const nameCode = String(asset.name || "").trim().toUpperCase();
      const assetCode = /^[A-Z0-9.-]+B$/.test(nameCode) ? nameCode : String(asset.ticker || asset.symbol || nameCode).trim().toUpperCase();
      try {
        const market = await getTokenizedEquityPrice(assetCode);
        asset.ticker = assetCode;
        asset.symbol = assetCode;
        asset.provider = "binance";
        asset.underlyingSymbol = market.underlyingSymbol;
        asset.currentPrice = market.currentPrice;
        asset.currency = market.quoteCurrency;
        asset.lastSyncedAt = new Date().toISOString();
        recordAssetPrice(data, asset, "sync", asset.lastSyncedAt);
        asset.marketData = {
          provider: "binance",
          bidPrice: market.bidPrice,
          askPrice: market.askPrice,
          multiplier: market.multiplier,
          tradability: market.tradability,
        };
        binanceSynced.push({ id: asset.id, name: asset.name, symbol: assetCode, underlyingSymbol: market.underlyingSymbol, price: market.currentPrice, currency: market.quoteCurrency });
      } catch (error) {
        binanceSkipped.push({
          id: asset.id,
          name: asset.name,
          symbol: assetCode,
          error: error.code || "BINANCE_API_ERROR",
          message: error.message,
        });
        if (error.code === "BINANCE_NOT_CONFIGURED") break;
      }
    }

    await writeData(data);

    res.json({
      synced,
      skipped,
      binanceSynced,
      binanceSkipped,
      note: "Inzhur and configured Binance stock/ETF holdings were synchronized. Binance tokenized assets use the official underlying mapping and latest bid/ask midpoint.",
    });
  } catch (error) {
    console.error("POST /api/assets/sync-inzhur:", error);
    res.status(502).json({ error: "Could not synchronize assets with Inzhur." });
  }
}));

/*
 * ==========================================================
 * API - ASSETS
 * ==========================================================
 */

/*
 * GET ALL ASSETS
 */

app.get("/api/assets", async (req, res) => {
  try {
    const data = await readData();

    res.json(data.assets);
  } catch (error) {
    console.error("GET /api/assets:", error);

    res.status(500).json({
      error: "Failed to read assets.",
    });
  }
});

/*
 * CREATE ASSET
 */

app.post("/api/assets", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const body = req.body || {};

    /*
     * ======================================================
     * BASIC DATA
     * ======================================================
     */

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const type = typeof body.type === "string" ? body.type : "";

    const currency = normalizeCurrency(body.currency);

    const quantity = normalizeNumber(body.quantity);

    const purchasePrice = normalizeNumber(body.purchasePrice);

    const purchaseDate = body.purchaseDate;

    const isin = typeof body.isin === "string" ? body.isin.trim().toUpperCase() : "";

    const currentPrice = normalizeNumber(body.currentPrice);

    /*
     * ======================================================
     * VALIDATION
     * ======================================================
     */

    if (!name) {
      return res.status(400).json({
        error: "Asset name is required.",
      });
    }

    const allowedTypes = ["ovdp", "inzhur_reit", "s1_reit", "inzhur_miltech", "etf", "stock", "savings", "novapay", "deposit"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        error: "Invalid asset type.",
      });
    }

    if (!isValidQuantity(quantity, type)) {
      return res.status(400).json({
        error: supportsFractionalQuantity(type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero.",
      });
    }

    if (purchasePrice < 0) {
      return res.status(400).json({
        error: "Purchase price cannot be negative.",
      });
    }

    if (!isValidDateString(purchaseDate)) {
      return res.status(400).json({
        error: "Valid purchase date is required.",
      });
    }

    /*
     * ======================================================
     * CREATE ASSET
     * ======================================================
     */

    const asset = {
      id: createId("asset"),

      createdAt: new Date().toISOString(),

      name,
      type,
      currency,
      quantity,
      purchasePrice,
      purchaseDate,
      isin: type === "ovdp" ? isin : "",
      currentPrice: ["s1_reit", "etf", "stock"].includes(type) && currentPrice > 0 ? currentPrice : undefined,
      instrumentName: typeof body.instrumentName === "string" ? body.instrumentName.trim() : "",
      instrumentType: typeof body.instrumentType === "string" ? body.instrumentType.trim() : "",
    };

    /*
     * ======================================================
     * REIT
     * ======================================================
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      const dividendPerUnit = normalizeNumber(body.dividendPerUnit);

      const firstDividendDate = body.firstDividendDate;

      if (dividendPerUnit <= 0) {
        return res.status(400).json({
          error: "Dividend per unit must be greater than zero.",
        });
      }

      if (!isValidDateString(firstDividendDate)) {
        return res.status(400).json({
          error: "Valid first dividend date is required.",
        });
      }

      asset.paymentMethod = "monthly_dividend";

      asset.dividendPerUnit = dividendPerUnit;

      asset.firstDividendDate = firstDividendDate;
    }

    /*
     * ======================================================
     * OVDP
     * ======================================================
     */

    if (type === "ovdp") {
      const maturityDate = body.maturityDate;

      if (!isValidDateString(maturityDate)) {
        return res.status(400).json({
          error: "Valid maturity date is required.",
        });
      }

      if (!Array.isArray(body.coupons) || body.coupons.length === 0) {
        return res.status(400).json({
          error: "At least one coupon is required.",
        });
      }

      const coupons = body.coupons
        .map((coupon) => ({
          date: coupon.date,

          amountPerUnit: normalizeNumber(coupon.amountPerUnit),
        }))
        .filter(
          (coupon) =>
            isValidDateString(coupon.date) && coupon.amountPerUnit > 0,
        );

      if (!coupons.length) {
        return res.status(400).json({
          error: "No valid coupons were provided.",
        });
      }

      asset.paymentMethod = "coupons";

      asset.maturityDate = maturityDate;

      asset.coupons = coupons;
    }

    /*
     * ======================================================
     * MILTECH
     * ======================================================
     */

    if (type === "inzhur_miltech") {
      asset.paymentMethod = "capitalization";
    }

    if (type === "etf" || type === "stock") {
      asset.paymentMethod = "capitalization";
      asset.ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    }

    if (body.isNewInstrument && asset.instrumentName) {
      const exists = data.instruments.some((item) => item.name.toLowerCase() === asset.instrumentName.toLowerCase());
      if (!exists) data.instruments.push({ id: createId("instrument"), name: asset.instrumentName, type: asset.instrumentType || "Other" });
    }

    if (type === "savings") {
      asset.paymentMethod = "none";
      asset.currentPrice = purchasePrice;
    }

    if (type === "novapay") {
      const termMonths = Math.min(12, Math.max(1, Math.trunc(normalizeNumber(body.termMonths))));
      const maturityAmount = normalizeNumber(body.maturityAmount);
      const maturityDate = body.maturityDate;
      if (!isValidDateString(maturityDate) || maturityAmount <= 0) return res.status(400).json({ error: "NovaPay maturity date and payout are required." });
      Object.assign(asset, { termMonths, maturityDate, maturityAmount, paymentMethod: "fixed_maturity", earlyWithdrawal: false });
    }

    if (type === "deposit") {
      const annualRate = normalizeNumber(body.annualRate);
      const maturityDate = body.maturityDate;
      if (!isValidDateString(maturityDate) || annualRate < 0) return res.status(400).json({ error: "Deposit maturity date and annual rate are required." });
      Object.assign(asset, { annualRate, maturityDate, earlyWithdrawal: Boolean(body.earlyWithdrawal), paymentMethod: "deposit_interest" });
    }

    /*
     * ======================================================
     * SAVE ASSET
     * ======================================================
     */

    data.assets.push(asset);

    /*
     * ======================================================
     * CREATE BUY TRANSACTION
     * ======================================================
     */

    data.transactions.push({
      id: createId("tx"),

      createdAt: new Date().toISOString(),

      date: purchaseDate,

      assetId: asset.id,

      assetName: asset.name,

      type: "BUY",

      quantity,

      amount: quantity * purchasePrice,

      currency,
    });

    /*
     * ======================================================
     * OVDP PAYMENTS
     * ======================================================
     */

    if (type === "ovdp") {
      /*
       * Coupons
       */

      asset.coupons.forEach((coupon) => {
        if (hasReceivedPayment(data, asset.id, "COUPON", coupon.date)) return;
        data.payments.push({
          id: createId("payment"),

          createdAt: new Date().toISOString(),

          assetId: asset.id,

          assetName: asset.name,

          date: coupon.date,

          type: "COUPON",

          amountPerUnit: coupon.amountPerUnit,

          amount: coupon.amountPerUnit * quantity,

          currency,

          status: "planned",
        });
      });

      /*
       * Maturity / redemption
       *
       * Ukrainian domestic bonds normally redeem at nominal value.
       */

      if (!hasReceivedPayment(data, asset.id, "MATURITY", asset.maturityDate)) data.payments.push({
        id: createId("payment"),

        createdAt: new Date().toISOString(),

        assetId: asset.id,

        assetName: asset.name,

        date: asset.maturityDate,

        type: "MATURITY",

        amountPerUnit: normalizeNumber(body.redemptionValue) || 1000,

        amount: (normalizeNumber(body.redemptionValue) || 1000) * quantity,

        currency,

        status: "planned",
      });
    }

    /*
     * ======================================================
     * REIT PAYMENTS
     * ======================================================
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      const startDate = new Date(`${asset.firstDividendDate}T00:00:00`);

      /*
       * Generate 24 monthly
       * dividend payments.
       */

      for (let i = 0; i < 24; i++) {
        const paymentDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth() + i,
          10,
        );

        /*
         * Do not generate a payment
         * before the first dividend date.
         */

        if (paymentDate < startDate) {
          continue;
        }

        const dateString = `${paymentDate.getFullYear()}-${String(
          paymentDate.getMonth() + 1,
        ).padStart(2, "0")}-${String(paymentDate.getDate()).padStart(2, "0")}`;

        if (hasReceivedPayment(data, asset.id, "DIVIDEND", dateString)) continue;
        data.payments.push({
          id: createId("payment"),

          createdAt: new Date().toISOString(),

          assetId: asset.id,

          assetName: asset.name,

          date: dateString,

          type: "DIVIDEND",

          amountPerUnit: asset.dividendPerUnit,

          amount: asset.dividendPerUnit * getDividendEligibleQuantity(data, asset.id, dateString),

          currency,

          status: "planned",
        });
      }
    }


    if (type === "novapay" || type === "deposit") {
      const principal = quantity * purchasePrice;
      let payout = asset.maturityAmount;
      if (type === "deposit") {
        const days = Math.max(0, (new Date(`${asset.maturityDate}T00:00:00`) - new Date(`${purchaseDate}T00:00:00`)) / 86400000);
        payout = principal * (1 + asset.annualRate / 100 * days / 365);
      }
      data.payments.push({ id: createId("payment"), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name, date: asset.maturityDate, type: "MATURITY", amountPerUnit: payout / quantity, amount: payout, currency, status: "planned" });
    }

    /*
     * ======================================================
     * MILTECH
     * ======================================================
     *
     * Capitalization is represented by
     * the asset itself increasing in value.
     *
     * We do NOT create a fake payment
     * with amount = 0.
     */

    /*
     * ======================================================
     * SAVE
     * ======================================================
     */

    await writeData(data);

    res.status(201).json(asset);
  } catch (error) {
    console.error("POST /api/assets:", error);

    res.status(500).json({
      error: "Failed to create asset.",
    });
  }
}));

app.post("/api/assets/merge", serializeMutation(async (req, res) => {
  try {
    const data = await readData();
    const ids = [...new Set(Array.isArray(req.body?.assetIds) ? req.body.assetIds.map(String) : [])];
    const assets = data.assets.filter((asset) => ids.includes(asset.id));
    if (assets.length < 2) return res.status(400).json({ error: "At least two holdings are required to merge." });

    const identity = (asset) => [asset.type, asset.name, asset.instrumentName || "", asset.instrumentType || "", asset.currency || "UAH"]
      .map((value) => String(value).trim().toLowerCase()).join("::");
    if (new Set(assets.map(identity)).size !== 1) {
      return res.status(400).json({ error: "Only the same asset on the same instrument can be merged." });
    }

    const primary = assets[0];
    const mergedIds = new Set(assets.slice(1).map((asset) => asset.id));
    const totalQuantity = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity), 0);
    const totalCost = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity) * normalizeNumber(asset.purchasePrice), 0);
    const totalCurrentValue = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity) * normalizeNumber(asset.currentPrice || asset.purchasePrice), 0);
    primary.quantity = totalQuantity;
    primary.purchasePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    primary.currentPrice = totalQuantity > 0 ? totalCurrentValue / totalQuantity : primary.currentPrice;
    primary.purchaseDate = assets.map((asset) => asset.purchaseDate).filter(Boolean).sort()[0] || primary.purchaseDate;
    primary.firstDividendDate = assets.map((asset) => asset.firstDividendDate).filter(Boolean).sort()[0] || primary.firstDividendDate;
    primary.updatedAt = new Date().toISOString();

    const reassign = (items = []) => items.map((item) => mergedIds.has(item.assetId)
      ? { ...item, assetId: primary.id, assetName: primary.name }
      : item);
    data.transactions = reassign(data.transactions);
    data.sales = reassign(data.sales);
    data.payments = reassign(data.payments);
    data.calendarNotes = reassign(data.calendarNotes);
    data.priceHistory = reassign(data.priceHistory);
    data.assets = data.assets.filter((asset) => !mergedIds.has(asset.id));

    const plannedKeys = new Set();
    data.payments = data.payments.filter((payment) => {
      if (payment.assetId !== primary.id || payment.status === "received" || payment.status === "paid") return true;
      if (hasReceivedPayment(data, primary.id, payment.type, payment.date)) return false;
      const key = [payment.type, payment.date, payment.currency || primary.currency].join("|");
      if (plannedKeys.has(key)) return false;
      plannedKeys.add(key);
      return true;
    });
    updatePlannedPaymentsForAsset(data, primary.id);

    await writeData(data);
    res.json(primary);
  } catch (error) {
    console.error("POST /api/assets/merge:", error);
    res.status(500).json({ error: "Failed to merge duplicate holdings." });
  }
}));

/*
 * ==========================================================
 * UPDATE ASSET
 * ==========================================================
 */

app.put("/api/assets/:id", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const assetId = req.params.id;

    const asset = data.assets.find((item) => item.id === assetId);

    if (!asset) {
      return res.status(404).json({
        error: "Asset not found.",
      });
    }

    const body = req.body || {};

    /*
     * ==================================================
     * BASIC DATA
     * ==================================================
     */

    const name = typeof body.name === "string" ? body.name.trim() : "";

    const type = typeof body.type === "string" ? body.type : "";

    const currency = normalizeCurrency(body.currency || asset.currency);

    const quantity = normalizeNumber(body.quantity);

    const purchasePrice = normalizeNumber(body.purchasePrice);

    const purchaseDate = body.purchaseDate;

    const isin = typeof body.isin === "string" ? body.isin.trim().toUpperCase() : "";

    const currentPrice = normalizeNumber(body.currentPrice);

    /*
     * ==================================================
     * BASIC VALIDATION
     * ==================================================
     */

    if (!name) {
      return res.status(400).json({
        error: "Asset name is required.",
      });
    }

    const allowedTypes = ["ovdp", "inzhur_reit", "s1_reit", "inzhur_miltech", "etf", "stock", "savings", "novapay", "deposit"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        error: "Invalid asset type.",
      });
    }

    if (!isValidQuantity(quantity, type)) {
      return res.status(400).json({
        error: supportsFractionalQuantity(type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero.",
      });
    }

    if (purchasePrice < 0) {
      return res.status(400).json({
        error: "Purchase price cannot be negative.",
      });
    }

    if (!isValidDateString(purchaseDate)) {
      return res.status(400).json({
        error: "Valid purchase date is required.",
      });
    }

    /*
     * ==================================================
     * VALIDATE TYPE-SPECIFIC DATA
     * ==================================================
     */

    let paymentMethod;
    let dividendPerUnit;
    let firstDividendDate;
    let maturityDate;
    let coupons = [];

    /*
     * REIT
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      dividendPerUnit = normalizeNumber(body.dividendPerUnit);

      firstDividendDate = body.firstDividendDate;

      if (dividendPerUnit <= 0) {
        return res.status(400).json({
          error: "Dividend per unit must be greater than zero.",
        });
      }

      if (!isValidDateString(firstDividendDate)) {
        return res.status(400).json({
          error: "Valid first dividend date is required.",
        });
      }

      paymentMethod = "monthly_dividend";
    }

    /*
     * OVDP
     */

    if (type === "ovdp") {
      maturityDate = body.maturityDate;

      if (!isValidDateString(maturityDate)) {
        return res.status(400).json({
          error: "Valid maturity date is required.",
        });
      }

      coupons = Array.isArray(body.coupons)
        ? body.coupons
            .map((coupon) => ({
              date: coupon.date,

              amountPerUnit: normalizeNumber(coupon.amountPerUnit),
            }))
            .filter(
              (coupon) =>
                isValidDateString(coupon.date) && coupon.amountPerUnit > 0,
            )
        : [];

      if (!coupons.length) {
        return res.status(400).json({
          error: "At least one valid coupon is required.",
        });
      }

      paymentMethod = "coupons";
    }

    /*
     * MILTECH
     */

    if (type === "inzhur_miltech") {
      paymentMethod = "capitalization";
    }

    /*
     * ==================================================
     * CHECK SOLD QUANTITY
     * ==================================================
     *
     * Do not allow the user to reduce
     * asset quantity below already sold quantity.
     */

    const soldQuantity = getSoldQuantity(data, assetId);

    if (quantity < soldQuantity) {
      return res.status(400).json({
        error: `Asset quantity cannot be less than already sold quantity (${soldQuantity}).`,
      });
    }

    /*
     * ==================================================
     * UPDATE ASSET
     * ==================================================
     */

    asset.name = name;

    asset.type = type;

    asset.currency = currency;

    asset.quantity = quantity;

    asset.purchasePrice = purchasePrice;

    asset.purchaseDate = purchaseDate;
    asset.instrumentName = typeof body.instrumentName === "string" ? body.instrumentName.trim() : asset.instrumentName || "";
    asset.instrumentType = typeof body.instrumentType === "string" ? body.instrumentType.trim() : asset.instrumentType || "";
    if (body.isNewInstrument && asset.instrumentName) {
      const exists = data.instruments.some((item) => item.name.toLowerCase() === asset.instrumentName.toLowerCase());
      if (!exists) data.instruments.push({ id: createId("instrument"), name: asset.instrumentName, type: asset.instrumentType || "Other" });
    }

    asset.isin = type === "ovdp" ? isin : "";

    if (["s1_reit", "etf", "stock"].includes(type) && body.currentPrice !== undefined && currentPrice > 0) {
      asset.currentPrice = currentPrice;
      asset.lastSyncedAt = new Date().toISOString();
      recordAssetPrice(data, asset, "edit", asset.lastSyncedAt);
    }

    /*
     * Clear old type-specific fields.
     */

    delete asset.paymentMethod;
    delete asset.dividendPerUnit;
    delete asset.firstDividendDate;
    delete asset.maturityDate;
    delete asset.coupons;

    asset.paymentMethod = paymentMethod;

    if (type === "etf" || type === "stock") {
      asset.paymentMethod = "capitalization";
      asset.ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    } else {
      delete asset.ticker;
    }

    if (type === "savings") {
      asset.paymentMethod = "none";
      asset.currentPrice = purchasePrice;
    }

    if (type === "novapay") {
      Object.assign(asset, { termMonths: Math.min(12, Math.max(1, Math.trunc(normalizeNumber(body.termMonths)))), maturityDate: body.maturityDate, maturityAmount: normalizeNumber(body.maturityAmount), earlyWithdrawal: false, paymentMethod: "fixed_maturity" });
    }

    if (type === "deposit") {
      Object.assign(asset, { annualRate: normalizeNumber(body.annualRate), maturityDate: body.maturityDate, earlyWithdrawal: Boolean(body.earlyWithdrawal), paymentMethod: "deposit_interest" });
    }

    /*
     * REIT FIELDS
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      asset.dividendPerUnit = dividendPerUnit;

      asset.firstDividendDate = firstDividendDate;
    }

    /*
     * OVDP FIELDS
     */

    if (type === "ovdp") {
      asset.maturityDate = maturityDate;

      asset.coupons = coupons;
      asset.redemptionValue = normalizeNumber(body.redemptionValue) || 1000;
    }

    asset.updatedAt = new Date().toISOString();

    /*
     * ==================================================
     * UPDATE RELATED NAMES
     * ==================================================
     */

    data.transactions = data.transactions.map((transaction) => {
      if (transaction.assetId !== assetId) {
        return transaction;
      }

      return {
        ...transaction,

        assetName: asset.name,
      };
    });

    data.sales = (data.sales || []).map((sale) => {
      if (sale.assetId !== assetId) {
        return sale;
      }

      return {
        ...sale,

        assetName: asset.name,
      };
    });

    data.calendarNotes = data.calendarNotes.map((note) => {
      if (note.assetId !== assetId) {
        return note;
      }

      return {
        ...note,

        assetName: asset.name,

        currency: asset.currency,
      };
    });

    /*
     * ==================================================
     * UPDATE BUY TRANSACTION
     * ==================================================
     */

    const buyTransactions = data.transactions.filter(
      (transaction) =>
        transaction.assetId === assetId && transaction.type === "BUY",
    );
    const buyTransaction = buyTransactions.length === 1 ? buyTransactions[0] : null;

    if (buyTransaction) {
      buyTransaction.assetName = asset.name;
      buyTransaction.currency = asset.currency;
    }

    /*
     * ==================================================
     * REMOVE OLD PLANNED PAYMENTS
     * ==================================================
     *
     * IMPORTANT:
     *
     * Received and paid payments
     * are preserved.
     */

    data.payments = data.payments.filter((payment) => {
      if (payment.assetId !== assetId) {
        return true;
      }

      return payment.status === "received" || payment.status === "paid";
    });

    /*
     * Update preserved payment names/currency.
     */

    data.payments = data.payments.map((payment) => {
      if (payment.assetId !== assetId) {
        return payment;
      }

      return {
        ...payment,

        assetName: asset.name,

        currency: asset.currency,
      };
    });

    /*
     * ==================================================
     * REBUILD OVDP PLANNED PAYMENTS
     * ==================================================
     */

    if (type === "ovdp") {
      asset.coupons.forEach((coupon) => {
        if (hasReceivedPayment(data, asset.id, "COUPON", coupon.date)) return;
        data.payments.push({
          id: createId("payment"),

          createdAt: new Date().toISOString(),

          assetId: asset.id,

          assetName: asset.name,

          date: coupon.date,

          type: "COUPON",

          amountPerUnit: coupon.amountPerUnit,

          amount: coupon.amountPerUnit * getPurchasedQuantityOnDate(data, asset.id, coupon.date),

          currency: asset.currency,

          status: "planned",
        });
      });

      /*
       * Maturity payment
       */

      if (!hasReceivedPayment(data, asset.id, "MATURITY", asset.maturityDate)) data.payments.push({
        id: createId("payment"),

        createdAt: new Date().toISOString(),

        assetId: asset.id,

        assetName: asset.name,

        date: asset.maturityDate,

        type: "MATURITY",

        amountPerUnit: asset.redemptionValue,

        amount: asset.redemptionValue * asset.quantity,

        currency: asset.currency,

        status: "planned",
      });
    }

    /*
     * ==================================================
     * REBUILD REIT PLANNED PAYMENTS
     * ==================================================
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      const startDate = new Date(`${asset.firstDividendDate}T00:00:00`);

      /*
       * Generate 24 monthly dividends.
       */

      for (let i = 0; i < 24; i++) {
        const paymentDate = new Date(
          startDate.getFullYear(),
          startDate.getMonth() + i,
          10,
        );

        if (paymentDate < startDate) {
          continue;
        }

        const dateString = `${paymentDate.getFullYear()}-${String(
          paymentDate.getMonth() + 1,
        ).padStart(2, "0")}-${String(paymentDate.getDate()).padStart(2, "0")}`;

        if (hasReceivedPayment(data, asset.id, "DIVIDEND", dateString)) continue;
        data.payments.push({
          id: createId("payment"),

          createdAt: new Date().toISOString(),

          assetId: asset.id,

          assetName: asset.name,

          date: dateString,

          type: "DIVIDEND",

          amountPerUnit: asset.dividendPerUnit,

          amount: asset.dividendPerUnit * getDividendEligibleQuantity(data, asset.id, dateString),

          currency: asset.currency,

          status: "planned",
        });
      }
    }

    if (type === "novapay" || type === "deposit") {
      const principal = asset.quantity * asset.purchasePrice;
      let payout = asset.maturityAmount;
      if (type === "deposit") {
        const days = Math.max(0, (new Date(`${asset.maturityDate}T00:00:00`) - new Date(`${asset.purchaseDate}T00:00:00`)) / 86400000);
        payout = principal * (1 + asset.annualRate / 100 * days / 365);
      }
      if (!hasReceivedPayment(data, asset.id, "MATURITY", asset.maturityDate)) data.payments.push({ id: createId("payment"), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name, date: asset.maturityDate, type: "MATURITY", amountPerUnit: payout / asset.quantity, amount: payout, currency: asset.currency, status: "planned" });
    }

    /*
     * ==================================================
     * UPDATE SALES
     * ==================================================
     *
     * Recalculate cost basis,
     * profit and ROI using the new
     * purchase price.
     */

    data.sales = (data.sales || []).map((sale) => {
      if (sale.assetId !== assetId) {
        return sale;
      }

      const saleQuantity = normalizeNumber(sale.quantity);

      const costBasis = saleQuantity * asset.purchasePrice;

      const saleProceeds = normalizeNumber(sale.saleProceeds);

      const profit = saleProceeds - costBasis;

      const roi = costBasis > 0 ? (profit / costBasis) * 100 : 0;

      return {
        ...sale,

        assetName: asset.name,

        type: asset.type,

        currency: asset.currency,

        purchasePrice: asset.purchasePrice,

        costBasis,

        profit,

        roi,
      };
    });

    /*
     * ==================================================
     * UPDATE SELL TRANSACTIONS
     * ==================================================
     */

    data.transactions = data.transactions.map((transaction) => {
      if (transaction.assetId !== assetId || transaction.type !== "SELL") {
        return transaction;
      }

      const sale = data.sales.find(
        (item) =>
          item.assetId === assetId &&
          item.sellDate === transaction.date &&
          normalizeNumber(item.quantity) ===
            normalizeNumber(transaction.quantity),
      );

      if (!sale) {
        return {
          ...transaction,

          assetName: asset.name,

          currency: asset.currency,
        };
      }

      return {
        ...transaction,

        assetName: asset.name,

        currency: sale.currency,

        costBasis: sale.costBasis,

        profit: sale.profit,

        roi: sale.roi,
      };
    });

    /*
     * ==================================================
     * SAVE
     * ==================================================
     */

    await writeData(data);

    res.json(asset);
  } catch (error) {
    console.error("PUT /api/assets/:id:", error);

    res.status(500).json({
      error: "Failed to update asset.",
    });
  }
}));

/*
 * ==========================================================
 * BUY MORE ASSET
 * ==========================================================
 */

app.post("/api/assets/:id/buy", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const assetId = req.params.id;

    const asset = data.assets.find((item) => item.id === assetId);

    if (!asset) {
      return res.status(404).json({
        error: "Asset not found.",
      });
    }

    const body = req.body || {};

    const quantity = normalizeNumber(body.quantity);

    const purchasePrice = normalizeNumber(body.purchasePrice);

    const purchaseDate = body.purchaseDate;

    /*
     * ==================================================
     * VALIDATION
     * ==================================================
     */

    if (!isValidQuantity(quantity, asset.type)) {
      return res.status(400).json({
        error: supportsFractionalQuantity(asset.type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero.",
      });
    }

    if (purchasePrice < 0) {
      return res.status(400).json({
        error: "Purchase price cannot be negative.",
      });
    }

    if (!isValidDateString(purchaseDate)) {
      return res.status(400).json({
        error: "Valid purchase date is required.",
      });
    }

    /*
     * ==================================================
     * CURRENT ASSET COST
     * ==================================================
     */

    const oldQuantity = normalizeNumber(asset.quantity);

    const oldAveragePrice = normalizeNumber(asset.purchasePrice);

    const oldCost = oldQuantity * oldAveragePrice;

    /*
     * ==================================================
     * NEW PURCHASE COST
     * ==================================================
     */

    const newCost = quantity * purchasePrice;

    const totalQuantity = oldQuantity + quantity;

    const totalCost = oldCost + newCost;

    const averagePurchasePrice =
      totalQuantity > 0 ? totalCost / totalQuantity : 0;

    /*
     * ==================================================
     * UPDATE PORTFOLIO ASSET
     * ==================================================
     */

    asset.quantity = totalQuantity;

    asset.purchasePrice = averagePurchasePrice;

    asset.updatedAt = new Date().toISOString();

    /*
     * ==================================================
     * CREATE SEPARATE BUY TRANSACTION
     * ==================================================
     */

    const transaction = {
      id: createId("tx"),

      createdAt: new Date().toISOString(),

      date: purchaseDate,

      assetId: asset.id,

      assetName: asset.name,

      type: "BUY",

      quantity,

      /*
       * Price of THIS purchase.
       *
       * This is important because
       * asset.purchasePrice is the
       * average price.
       */

      purchasePrice,

      amount: newCost,

      currency: asset.currency,
    };

    data.transactions.push(transaction);

    /*
     * ==================================================
     * RECALCULATE FUTURE PLANNED PAYMENTS
     * ==================================================
     *
     * The amount of every planned
     * coupon/dividend depends on how
     * many units were purchased by
     * the payment date.
     *
     * Received payments are untouched.
     */

    updatePlannedPaymentsForAsset(data, assetId);

    if (asset.type === "novapay" || asset.type === "deposit") {
      const maturity = data.payments.find((payment) => payment.assetId === assetId && payment.type === "MATURITY" && payment.status === "planned");
      if (maturity) {
        if (asset.type === "novapay") {
          const payoutPerUnit = normalizeNumber(maturity.amountPerUnit);
          maturity.amount = payoutPerUnit * asset.quantity;
        } else {
          const days = Math.max(0, (new Date(`${asset.maturityDate}T00:00:00`) - new Date(`${asset.purchaseDate}T00:00:00`)) / 86400000);
          maturity.amount = asset.quantity * asset.purchasePrice * (1 + normalizeNumber(asset.annualRate) / 100 * days / 365);
          maturity.amountPerUnit = maturity.amount / asset.quantity;
        }
      }
    }

    /*
     * ==================================================
     * UPDATE SALES COST BASIS
     * ==================================================
     *
     * Portfolio average price changed.
     */

    data.sales = (data.sales || []).map((sale) => {
      if (sale.assetId !== assetId) {
        return sale;
      }

      /*
       * We do not rewrite
       * historical sale results.
       *
       * Each sale keeps its
       * original stored values.
       */

      return sale;
    });

    /*
     * ==================================================
     * SAVE
     * ==================================================
     */

    await writeData(data);

    res.status(201).json({
      asset,

      transaction,
    });
  } catch (error) {
    console.error("POST /api/assets/:id/buy:", error);

    res.status(500).json({
      error: "Failed to buy more asset.",
    });
  }
}));

/*
 * DELETE ASSET
 */

app.delete("/api/assets/:id", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const assetId = req.params.id;

    const index = data.assets.findIndex((asset) => asset.id === assetId);

    if (index === -1) {
      return res.status(404).json({
        error: "Asset not found.",
      });
    }

    const [removedAsset] = data.assets.splice(index, 1);

    /*
     * Remove related transactions.
     */

    data.transactions = data.transactions.filter(
      (transaction) => transaction.assetId !== assetId,
    );

    /*
     * Remove related payments.
     */

    data.payments = data.payments.filter(
      (payment) => payment.assetId !== assetId,
    );

    /*
     * Remove related sales.
     */

    data.sales = data.sales.filter((sale) => sale.assetId !== assetId);

    /*
     * Remove related calendar notes.
     */

    data.calendarNotes = data.calendarNotes.filter(
      (note) => note.assetId !== assetId,
    );
    data.priceHistory = (data.priceHistory || []).filter(
      (point) => point.assetId !== assetId,
    );

    await writeData(data);

    res.json({
      success: true,
      asset: removedAsset,
    });
  } catch (error) {
    console.error("DELETE /api/assets/:id:", error);

    res.status(500).json({
      error: "Failed to delete asset.",
    });
  }
}));

/*
 * ==========================================================
 * API - TRANSACTIONS
 * ==========================================================
 */

app.get("/api/transactions", async (req, res) => {
  try {
    const data = await readData();

    res.json(data.transactions);
  } catch (error) {
    console.error("GET /api/transactions:", error);

    res.status(500).json({
      error: "Failed to read transactions.",
    });
  }
});

app.post("/api/transactions", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const transaction = {
      id: createId("tx"),

      createdAt: new Date().toISOString(),

      ...req.body,
    };

    if (
      transaction.quantity != null &&
      !isPositiveInteger(normalizeNumber(transaction.quantity))
    ) {
      return res.status(400).json({
        error: "Quantity must be a whole number greater than zero.",
      });
    }

    if (transaction.quantity != null) {
      transaction.quantity = normalizeNumber(transaction.quantity);
    }

    data.transactions.push(transaction);

    await writeData(data);

    res.status(201).json(transaction);
  } catch (error) {
    console.error("POST /api/transactions:", error);

    res.status(500).json({
      error: "Failed to create transaction.",
    });
  }
}));

/*
 * ==========================================================
 * API - SALES
 * ==========================================================
 */

/*
 * GET ALL SALES
 */

app.get("/api/sales", async (req, res) => {
  try {
    const data = await readData();

    res.json(data.sales || []);
  } catch (error) {
    console.error("GET /api/sales:", error);

    res.status(500).json({
      error: "Failed to read sales.",
    });
  }
});

/*
 * CREATE SALE
 */

app.post("/api/sales", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const { assetId, quantity, sellPrice, sellDate, currency } = req.body || {};

    /*
     * ======================================================
     * VALIDATION
     * ======================================================
     */

    if (!assetId) {
      return res.status(400).json({
        error: "Asset is required.",
      });
    }

    const soldQuantity = normalizeNumber(quantity);

    const asset = data.assets.find((item) => item.id === assetId);

    if (!asset) {
      return res.status(404).json({ error: "Asset not found." });
    }

    if (asset.type === "novapay" || (asset.type === "deposit" && !asset.earlyWithdrawal)) {
      return res.status(400).json({ error: "This asset cannot be withdrawn before maturity." });
    }

    if (!isValidQuantity(soldQuantity, asset.type)) {
      return res.status(400).json({
        error: supportsFractionalQuantity(asset.type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero.",
      });
    }

    const price = normalizeNumber(sellPrice);

    if (price < 0) {
      return res.status(400).json({
        error: "Sell price cannot be negative.",
      });
    }

    if (!isValidDateString(sellDate)) {
      return res.status(400).json({
        error: "Valid sell date is required.",
      });
    }

    /*
     * ======================================================
     * FIND ASSET
     * ======================================================
     */

    /*
     * ======================================================
     * AVAILABLE QUANTITY
     * ======================================================
     */

    const availableQuantity = getAvailableQuantity(data, assetId);

    if (soldQuantity > availableQuantity) {
      return res.status(400).json({
        error:
          `You cannot sell ${soldQuantity} units. ` +
          `Only ${availableQuantity} units are available.`,
      });
    }

    /*
     * ======================================================
     * PROFIT
     * ======================================================
     */

    const purchasePrice = normalizeNumber(asset.purchasePrice);

    const costBasis = soldQuantity * purchasePrice;

    const saleProceeds = soldQuantity * price;

    const profit = saleProceeds - costBasis;

    const roi = costBasis > 0 ? (profit / costBasis) * 100 : 0;

    const saleCurrency = asset.currency || normalizeCurrency(currency);

    /*
     * ======================================================
     * SALE RECORD
     * ======================================================
     */

    const sale = {
      id: createId("sale"),

      createdAt: new Date().toISOString(),

      assetId: asset.id,

      assetName: asset.name,

      type: asset.type,

      quantity: soldQuantity,

      sellPrice: price,

      sellDate,

      currency: saleCurrency,

      purchasePrice,

      costBasis,

      saleProceeds,

      profit,

      roi,
    };

    data.sales.push(sale);

    /*
     * ======================================================
     * SELL TRANSACTION
     * ======================================================
     */

    const transaction = {
      id: createId("tx"),

      createdAt: new Date().toISOString(),

      date: sellDate,

      assetId: asset.id,

      assetName: asset.name,

      type: "SELL",

      quantity: soldQuantity,

      amount: saleProceeds,

      currency: saleCurrency,

      costBasis,

      profit,

      roi,
    };

    data.transactions.push(transaction);

    /*
     * ======================================================
     * SAVE
     * ======================================================
     */

    await writeData(data);

    res.status(201).json({
      sale,
      transaction,

      remainingQuantity: availableQuantity - soldQuantity,
    });
  } catch (error) {
    console.error("POST /api/sales:", error);

    res.status(500).json({
      error: "Failed to create sale.",
    });
  }
}));

/*
 * ==========================================================
 * API - PAYMENTS
 * ==========================================================
 */

/*
 * GET PAYMENTS
 */

app.get("/api/payments", async (req, res) => {
  try {
    const data = await readData();

    res.json(data.payments);
  } catch (error) {
    console.error("GET /api/payments:", error);

    res.status(500).json({
      error: "Failed to read payments.",
    });
  }
});

/*
 * CREATE PAYMENT
 */

app.post("/api/payments", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const payment = {
      id: createId("payment"),

      createdAt: new Date().toISOString(),

      ...req.body,
    };

    if (payment.date && !isValidDateString(payment.date)) {
      return res.status(400).json({
        error: "Invalid payment date.",
      });
    }

    payment.amount = normalizeNumber(payment.amount);
    payment.currency = normalizeCurrency(payment.currency);

    if (payment.amountPerUnit != null) {
      payment.amountPerUnit = normalizeNumber(payment.amountPerUnit);
    }

    data.payments.push(payment);

    await writeData(data);

    res.status(201).json(payment);
  } catch (error) {
    console.error("POST /api/payments:", error);

    res.status(500).json({
      error: "Failed to create payment.",
    });
  }
}));

/*
 * ==========================================================
 * MARK PAYMENT AS RECEIVED
 * ==========================================================
 */

app.patch("/api/payments/:id/received", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const paymentId = req.params.id;

    const payment = data.payments.find((item) => item.id === paymentId);

    if (!payment) {
      return res.status(404).json({
        error: "Payment not found.",
      });
    }

    /*
     * Prevent marking an already
     * received payment twice.
     */

    if (payment.status === "received") {
      return res.json(payment);
    }

    /*
     * Mark payment as received.
     */

    payment.status = "received";

    const receivedNow = new Date();
    payment.receivedAt = receivedNow.toISOString();
    payment.receivedDate = `${receivedNow.getFullYear()}-${String(receivedNow.getMonth() + 1).padStart(2, "0")}-${String(receivedNow.getDate()).padStart(2, "0")}`;

    const asset = data.assets.find((item) => item.id === payment.assetId);

    if (payment.type === "MATURITY" && asset) {
      asset.closedAt = payment.receivedAt;
    }

    data.transactions.push({
      id: createId("tx"),
      createdAt: payment.receivedAt,
      date: payment.receivedDate,
      assetId: payment.assetId,
      assetName: payment.assetName,
      paymentId: payment.id,
      type: payment.type,
      quantity: null,
      amount: payment.amount,
      currency: payment.currency || BASE_CURRENCY,
    });

    /*
     * Save updated data.
     */

    await writeData(data);

    /*
     * Return updated payment.
     */

    res.json(payment);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to mark payment as received.",
    });
  }
}));

/*
 * ==========================================================
 * API - CALENDAR NOTES
 * ==========================================================
 */

/*
 * GET CALENDAR NOTES
 */

app.get("/api/calendar-notes", async (req, res) => {
  try {
    const data = await readData();

    res.json(data.calendarNotes);
  } catch (error) {
    console.error("GET /api/calendar-notes:", error);

    res.status(500).json({
      error: "Failed to read calendar notes.",
    });
  }
});

/*
 * CREATE CALENDAR NOTE
 */

app.post("/api/calendar-notes", serializeMutation(async (req, res) => {
  try {
    const data = await readData();

    const body = req.body || {};

    const date = body.date;

    const assetId = body.assetId;

    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!isValidDateString(date)) {
      return res.status(400).json({
        error: "Valid note date is required.",
      });
    }

    if (!assetId) {
      return res.status(400).json({
        error: "Asset is required.",
      });
    }

    if (!text) {
      return res.status(400).json({
        error: "Note text is required.",
      });
    }

    const asset = data.assets.find((item) => item.id === assetId);

    if (!asset) {
      return res.status(404).json({
        error: "Asset not found.",
      });
    }

    const note = {
      id: createId("note"),

      createdAt: new Date().toISOString(),

      date,

      assetId,

      assetName: asset.name,

      text,

      amount: normalizeNumber(body.amount),

      currency: BASE_CURRENCY,
    };

    data.calendarNotes.push(note);

    await writeData(data);

    res.status(201).json(note);
  } catch (error) {
    console.error("POST /api/calendar-notes:", error);

    res.status(500).json({
      error: "Failed to create calendar note.",
    });
  }
}));

/* ==========================================================
 * WALLET / PERSONAL BUDGET
 * ========================================================== */

app.put("/api/wallet", serializeMutation(async (req, res) => {
  try {
    const data = await readData();
    const wallet = req.body || {};
    if (!Array.isArray(wallet.expenses) || !wallet.months || typeof wallet.months !== "object") {
      return res.status(400).json({ error: "Invalid wallet data." });
    }

    wallet.expenses = wallet.expenses.map((expense) => ({
      id: expense.id || createId("expense"),
      createdAt: expense.createdAt || new Date().toISOString(),
      date: expense.date,
      category: String(expense.category || "").trim(),
      amount: normalizeNumber(expense.amount),
      note: String(expense.note || "").trim(),
      currency: BASE_CURRENCY,
    })).filter((expense) => isValidDateString(expense.date) && expense.category && expense.amount > 0);

    data.wallet = wallet;
    await writeData(data);
    res.json(data.wallet);
  } catch (error) {
    console.error("PUT /api/wallet:", error);
    res.status(500).json({ error: "Failed to save wallet." });
  }
}));

/*
 * ==========================================================
 * FRONTEND FALLBACK
 * ==========================================================
 *
 * Express 5 syntax:
 * "*splat" instead of "*"
 */

app.get("*splat", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

/*
 * ==========================================================
 * ERROR HANDLER
 * ==========================================================
 */

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Internal server error.",
  });
});

/*
 * ==========================================================
 * START SERVER
 * ==========================================================
 */

app.listen(PORT, () => {
  console.log(`Investment Tracker is running at http://localhost:${PORT}`);
});
