/* ============================================================
   INVESTMENT TRACKER
   APP.JS
   ============================================================ */

const state = {
  data: {
    assets: [],
    transactions: [],
    payments: [],
    calendarNotes: [],
    sales: [],
    wallet: { expenses: [], months: {} },
    instruments: [],
  },

  calendarDate: new Date(),

  portfolioSort: "purchase-date",

  editingAssetId: null,
  editingAssetIds: [],
  sp500Benchmark: null,
  buyingAssetId: null,
  rebalanceDrafts: [],
  rebalanceExcluded: [],
  editingLoanId: null,
  editingExpenseId: null,
  holdingSelectionAction: "delete",
  purchaseExchangeRates: {},
};

/* ============================================================
   CONSTANTS
   ============================================================ */

const typeLabels = {
  ovdp: "OVDP",
  inzhur_reit: "Inzhur REIT",
  s1_reit: "S1 REIT",
  inzhur_miltech: "Inzhur MilTech",
  etf: "ETF",
  stock: "Stock",
  savings: "Savings",
  novapay: "NovaPay",
  deposit: "Bank deposit",
};

const DEFAULT_INSTRUMENTS = [
  { name: "Inzhur", type: "Broker" },
  { name: "Універ", type: "Broker" },
  { name: "Binance", type: "Crypto exchange" },
  { name: "cash", type: "Cash" },
  { name: "monobank", type: "Bank" },
  { name: "Pryvatbank", type: "Bank" },
];

function populateInstrumentSelect(selectedName = "") {
  const select = document.querySelector("#asset-instrument");
  if (!select) return;
  const instruments = [...DEFAULT_INSTRUMENTS, ...(state.data.instruments || [])]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.name.toLowerCase() === item.name.toLowerCase()) === index);
  select.innerHTML = instruments.map((item) => `<option value="${escapeHtml(item.name)}" data-instrument-type="${escapeHtml(item.type)}">${escapeHtml(item.name)} — ${escapeHtml(item.type)}</option>`).join("") + '<option value="__new__">New instrument...</option>';
  if (selectedName && instruments.some((item) => item.name === selectedName)) select.value = selectedName;
  updateNewInstrumentFields();
}

function updateNewInstrumentFields() {
  const isNew = document.querySelector("#asset-instrument")?.value === "__new__";
  const nameField = document.querySelector("#new-instrument-name-field");
  const typeField = document.querySelector("#new-instrument-type-field");
  if (nameField) nameField.hidden = !isNew;
  if (typeField) typeField.hidden = !isNew;
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const currencyFormatter = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const quantityFormatter = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/* ============================================================
   HELPERS
   ============================================================ */

const EXCHANGE_RATES = { UAH: 1, USD: 44.4, EUR: 51.7 };
const HISTORICAL_RATE_FALLBACKS = { UAH: 1, USD: 44.4, EUR: 51.7 };

function toUAH(value, currency = "UAH") {
  return normalizeNumber(value) * (EXCHANGE_RATES[currency] || 1);
}

function getExchangeRateOnDate(currency = "UAH", date = "") {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  if (normalizedCurrency === "UAH") return 1;

  const rates = state.purchaseExchangeRates[normalizedCurrency] || [];
  const normalizedDate = String(date || "").slice(0, 10);
  if (!normalizedDate || !rates.length) return HISTORICAL_RATE_FALLBACKS[normalizedCurrency] || 1;

  const rate = [...rates].reverse().find((item) => item.date <= normalizedDate) || rates[0];
  return normalizeNumber(rate?.rate) || HISTORICAL_RATE_FALLBACKS[normalizedCurrency] || 1;
}

function toUAHAtDate(value, currency = "UAH", date = "") {
  return normalizeNumber(value) * getExchangeRateOnDate(currency, date);
}

function getAssetPurchaseDate(assetId, fallback = "") {
  const asset = (state.data.assets || []).find((item) => item.id === assetId);
  if (asset?.purchaseDate) return asset.purchaseDate;

  return (state.data.transactions || [])
    .filter((transaction) => transaction.assetId === assetId && transaction.type === "BUY" && transaction.date)
    .map((transaction) => transaction.date)
    .sort()[0] || fallback;
}

function getAssetPurchaseExchangeRate(assetId, currency = "UAH", fallbackDate = "") {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  if (normalizedCurrency === "UAH") return 1;

  const purchases = (state.data.transactions || []).filter(
    (transaction) =>
      transaction.assetId === assetId &&
      transaction.type === "BUY" &&
      String(transaction.currency || normalizedCurrency).toUpperCase() === normalizedCurrency,
  );
  const totals = purchases.reduce((result, transaction) => {
    const amount = normalizeNumber(transaction.amount) ||
      normalizeNumber(transaction.quantity) * normalizeNumber(transaction.purchasePrice ?? transaction.price);
    result.foreign += amount;
    result.uah += toUAHAtDate(amount, normalizedCurrency, transaction.date || fallbackDate);
    return result;
  }, { foreign: 0, uah: 0 });

  return totals.foreign > 0
    ? totals.uah / totals.foreign
    : getExchangeRateOnDate(normalizedCurrency, fallbackDate);
}

function toUAHPurchaseCost(value, currency = "UAH", assetId = "", fallbackDate = "") {
  return normalizeNumber(value) * getAssetPurchaseExchangeRate(assetId, currency, fallbackDate);
}

function getAssetInvestedUah(asset, quantity = getAvailableQuantity(asset.id)) {
  return toUAHPurchaseCost(
    quantity * normalizeNumber(asset.purchasePrice),
    asset.currency,
    asset.id,
    asset.purchaseDate,
  );
}

function getAssetInvestedUsd(asset, quantity = getAvailableQuantity(asset.id)) {
  const purchases = (state.data.transactions || []).filter(
    (transaction) => transaction.assetId === asset.id && transaction.type === "BUY",
  );
  const totalQuantity = purchases.reduce((sum, transaction) => sum + normalizeNumber(transaction.quantity), 0);
  const investedUsd = purchases.reduce((sum, transaction) => {
    const currency = String(transaction.currency || asset.currency || "UAH").toUpperCase();
    const amount = normalizeNumber(transaction.amount) ||
      normalizeNumber(transaction.quantity) * normalizeNumber(transaction.purchasePrice ?? transaction.price);
    if (currency === "USD") return sum + amount;
    const amountUah = currency === "UAH" ? amount : toUAHAtDate(amount, currency, transaction.date);
    return sum + amountUah / getExchangeRateOnDate("USD", transaction.date || asset.purchaseDate);
  }, 0);
  if (totalQuantity > 0) return investedUsd * Math.min(1, normalizeNumber(quantity) / totalQuantity);

  const amount = normalizeNumber(quantity) * normalizeNumber(asset.purchasePrice);
  const currency = String(asset.currency || "UAH").toUpperCase();
  if (currency === "USD") return amount;
  const amountUah = currency === "UAH" ? amount : toUAHAtDate(amount, currency, asset.purchaseDate);
  return amountUah / getExchangeRateOnDate("USD", asset.purchaseDate);
}

async function loadPurchaseExchangeRates() {
  const cacheKey = "fino-purchase-exchange-rates-v1";
  try {
    const cachedRates = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    if (cachedRates && typeof cachedRates === "object") state.purchaseExchangeRates = cachedRates;
  } catch (_) {
    state.purchaseExchangeRates = {};
  }

  const allPurchaseDates = [
    ...(state.data.assets || []).map((asset) => asset.purchaseDate),
    ...(state.data.transactions || [])
      .filter((transaction) => transaction.type === "BUY")
      .map((transaction) => transaction.date),
  ].filter(Boolean);
  const purchaseRecords = [
    ...(state.data.assets || []).map((asset) => ({
      currency: asset.currency,
      date: asset.purchaseDate,
    })),
    ...(state.data.transactions || [])
      .filter((transaction) => transaction.type === "BUY")
      .map((transaction) => ({ currency: transaction.currency, date: transaction.date })),
  ].filter(
    (record) => record.date && ["USD", "EUR"].includes(String(record.currency || "").toUpperCase()),
  );
  const currencies = [...new Set(["USD", ...purchaseRecords.map((record) => String(record.currency).toUpperCase())])];

  await Promise.all(currencies.map(async (currency) => {
    const dates = (currency === "USD" ? allPurchaseDates : purchaseRecords
      .filter((record) => String(record.currency).toUpperCase() === currency)
      .map((record) => record.date)).sort();
    if (!dates.length) return;
    const firstDate = new Date(`${dates[0]}T00:00:00`);
    firstDate.setDate(firstDate.getDate() - 7);
    const today = getDateString(new Date());
    const endDate = dates.at(-1) > today ? today : dates.at(-1);

    try {
      const result = await api.getCurrencyHistory({
        code: currency,
        startDate: getDateString(firstDate),
        endDate,
      });
      state.purchaseExchangeRates[currency] = (result.values || [])
        .map((item) => ({ date: String(item.datetime || "").slice(0, 10), rate: normalizeNumber(item.close) }))
        .filter((item) => item.date && item.rate > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      localStorage.setItem(cacheKey, JSON.stringify(state.purchaseExchangeRates));
    } catch (error) {
      console.warn(`Could not load historical ${currency}/UAH rates:`, error.message);
    }
  }));
}

function convertCurrency(value, fromCurrency = "UAH", toCurrency = "UAH") {
  const targetRate = EXCHANGE_RATES[String(toCurrency || "UAH").toUpperCase()] || 1;
  return toUAH(value, String(fromCurrency || "UAH").toUpperCase()) / targetRate;
}

function money(value, currency = "UAH") {
  const number = Number(value) || 0;

  const symbols = { UAH: "₴", USD: "$", EUR: "€" };
  return `${currencyFormatter.format(number)} ${symbols[currency] || currency}`;
}

const CAPITAL_GAINS_TAX_RATE = 0.23;

function usdMoney(value) {
  const number = (Number(value) || 0) / EXCHANGE_RATES.USD;

  return `$${currencyFormatter.format(number)}`;
}

function formatQuantity(value) {
  return quantityFormatter.format(normalizeNumber(value));
}

function setDashboardCurrencyHover(element, valueInUah, valueInUsd = null) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  element.dataset.valueUah = money(valueInUah);
  element.dataset.valueUsd = valueInUsd == null
    ? usdMoney(valueInUah)
    : `$${currencyFormatter.format(valueInUsd)}`;
  element.textContent = card.matches(":hover") ? element.dataset.valueUsd : element.dataset.valueUah;
  card.classList.add("currency-hover-card");
  card.removeAttribute("title");
  card.tabIndex = 0;
  if (card.dataset.currencyHoverBound) return;
  card.dataset.currencyHoverBound = "true";
  const showUsd = () => { element.textContent = element.dataset.valueUsd; };
  const showUah = () => { element.textContent = element.dataset.valueUah; };
  card.addEventListener("mouseenter", showUsd);
  card.addEventListener("mouseleave", showUah);
  card.addEventListener("focus", showUsd);
  card.addEventListener("blur", showUah);
}

function setReturnBenchmarkHover(element, portfolioReturn) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  const label = document.querySelector("#stat-return-label");
  element.dataset.portfolioReturn = `${portfolioReturn.toFixed(2)}%`;
  element.textContent = element.dataset.portfolioReturn;
  card.classList.add("currency-hover-card");
  card.title = "Compare with S&P 500";
  card.tabIndex = 0;
  if (!card.dataset.benchmarkHoverBound) {
    card.dataset.benchmarkHoverBound = "true";
    const showBenchmark = () => {
      if (label) label.textContent = "S&P 500";
      element.textContent = state.sp500Benchmark == null ? "Unavailable" : `${state.sp500Benchmark >= 0 ? "+" : ""}${state.sp500Benchmark.toFixed(2)}%`;
    };
    const showPortfolioReturn = () => {
      if (label) label.textContent = "Return";
      element.textContent = element.dataset.portfolioReturn;
    };
    card.addEventListener("mouseenter", showBenchmark);
    card.addEventListener("mouseleave", showPortfolioReturn);
    card.addEventListener("focus", showBenchmark);
    card.addEventListener("blur", showPortfolioReturn);
  }
}

function renderReinvestmentForecast(totalProfit, investedCapital) {
  const amountElement = document.querySelector("#stat-reinvestment");
  const averageElement = document.querySelector("#stat-average-monthly-profit");
  if (!amountElement || !averageElement) return;
  const dates = (state.data.transactions || []).map((item) => item.date).filter(Boolean).sort();
  if (!dates.length || investedCapital <= 0) {
    amountElement.dataset.valueUah = "—";
    amountElement.dataset.valueUsd = "—";
    amountElement.textContent = "—";
    averageElement.textContent = "Average monthly profit: insufficient history";
    return;
  }
  const firstDate = new Date(`${dates[0]}T00:00:00`);
  const elapsedMonths = Math.max(1, (Date.now() - firstDate.getTime()) / (30.4375 * 86400000));
  const averageMonthlyProfit = totalProfit / elapsedMonths;
  const monthlyReturnRate = averageMonthlyProfit / investedCapital;
  averageElement.textContent = `Average monthly profit: ${money(averageMonthlyProfit)}`;
  if (monthlyReturnRate <= 0) {
    amountElement.dataset.valueUah = "Insufficient positive return";
    amountElement.dataset.valueUsd = "Insufficient positive return";
    amountElement.textContent = "Insufficient positive return";
    return;
  }
  const targetMonthlyIncome = 1000 * EXCHANGE_RATES.USD;
  const additionalInvestment = Math.max(0, targetMonthlyIncome / monthlyReturnRate - investedCapital);
  setDashboardCurrencyHover(amountElement, additionalInvestment);
}

async function updateSp500Benchmark() {
  const dates = (state.data.transactions || []).map((item) => item.date).filter(Boolean).sort();
  state.sp500Benchmark = null;
  if (!dates.length) return;
  try {
    const result = await api.getIndexHistory({ symbol: ".INX", startDate: dates[0], endDate: new Date().toISOString().slice(0, 10) });
    const values = result.values || [];
    if (values.length > 1 && normalizeNumber(values[0].close) > 0) {
      state.sp500Benchmark = (normalizeNumber(values.at(-1).close) / normalizeNumber(values[0].close) - 1) * 100;
    }
  } catch (error) {
    console.warn("Could not load the S&P 500 benchmark:", error.message);
  }
}

function formatDate(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("uk-UA");
}

function getDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
}

let noticeResolver = null;

function showNotice(message, title = "Message") {
  const modal = document.querySelector("#notice-modal");
  if (!modal) return Promise.resolve(true);
  document.querySelector("#notice-title").textContent = title;
  document.querySelector("#notice-message").textContent = String(message || "");
  document.querySelector("#notice-cancel").hidden = true;
  modal.classList.add("open");
  return new Promise((resolve) => { noticeResolver = resolve; });
}

function showConfirm(message, title = "Please confirm") {
  const promise = showNotice(message, title);
  document.querySelector("#notice-cancel").hidden = false;
  return promise;
}

function setupNoticeModal() {
  const modal = document.querySelector("#notice-modal");
  const close = (result) => { modal?.classList.remove("open"); noticeResolver?.(result); noticeResolver = null; };
  document.querySelector("#notice-ok")?.addEventListener("click", () => close(true));
  document.querySelector("#notice-cancel")?.addEventListener("click", () => close(false));
  document.querySelector("#close-notice-modal")?.addEventListener("click", () => close(false));
}

function setupModalBackdropClosing() {
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target !== backdrop) return;
      const closeButton = backdrop.querySelector(".modal-header .icon-btn");
      if (closeButton) closeButton.click();
      else backdrop.classList.remove("open");
    });
  });
}

function driveStatusLabel(status) {
  if (status.syncing) return "Syncing";
  if (status.authorizationRequired) return "Authorization required";
  if (status.conflict) return "Conflict detected";
  if (status.connected && !status.pendingUpload) return "Synced";
  return "Offline — changes saved locally";
}

function renderGoogleDriveStatus(status) {
  const label = driveStatusLabel(status);
  document.querySelectorAll(".drive-sync-panel").forEach((panel) => {
    panel.classList.toggle("is-offline", !status.connected && !status.authorizationRequired && !status.conflict);
    panel.classList.toggle("is-auth", Boolean(status.authorizationRequired));
    panel.classList.toggle("is-conflict", Boolean(status.conflict));
    panel.querySelector("[data-drive-connection]").textContent = `Google Drive: ${status.connected ? "Connected" : "Offline"}`;
    panel.querySelector("[data-drive-state]").textContent = label;
    panel.querySelector("[data-drive-last-sync]").textContent = `Last sync: ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "—"}`;
    panel.querySelectorAll("[data-drive-action]").forEach((button) => { button.disabled = Boolean(status.syncing); });
  });
}

async function refreshGoogleDriveStatus() {
  try { renderGoogleDriveStatus(await api.getGoogleDriveStatus()); }
  catch (_) { renderGoogleDriveStatus({ connected: false, error: true }); }
}

function setupGoogleDriveSync() {
  document.querySelectorAll("[data-drive-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.driveAction;
      const confirmations = {
        download: "Download from Drive and replace the local data file? A backup of the local data will be created first.",
        upload: "Upload local data and replace fino-data.json on Google Drive? A backup of the Drive data will be created first.",
        reconnect: "Disconnect the current Google authorization? You will need to run npm run google-auth again.",
      };
      if (confirmations[action] && !(await showConfirm(confirmations[action], "Google Drive"))) return;
      document.querySelectorAll("[data-drive-action]").forEach((item) => { item.disabled = true; });
      document.querySelectorAll("[data-drive-state]").forEach((item) => { item.textContent = "Syncing"; });
      try {
        const result = await api.syncGoogleDrive(action);
        renderGoogleDriveStatus(result.status);
        if (action === "download") await loadData();
        if (action === "reconnect") await showNotice("Run npm run google-auth in the project console, then restart the server.", "Authorization required");
        else if (action === "backup") await showNotice("Google Drive backup created.");
      } catch (error) {
        await refreshGoogleDriveStatus();
        await showNotice(error.message || "Google Drive operation failed.", "Google Drive");
      } finally {
        await refreshGoogleDriveStatus();
      }
    });
  });
  refreshGoogleDriveStatus();
  window.setInterval(refreshGoogleDriveStatus, 15000);
}

function setupSettingsModal() {
  const modal = document.querySelector("#settings-modal");
  const close = () => modal?.classList.remove("open");
  document.querySelectorAll("[data-open-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      modal?.classList.add("open");
      refreshGoogleDriveStatus();
    });
  });
  document.querySelector("#close-settings-modal")?.addEventListener("click", close);
  document.querySelector("#settings-logout")?.addEventListener("click", () => showNotice("Log out is not available yet.", "Account"));
}

function paymentTypeLabel(type) {
  const labels = {
    COUPON: "Coupon",
    DIVIDEND: "Dividend",
    MATURITY: "Maturity",
    CAPITALIZATION: "Capitalization",
  };

  return labels[type] || type || "-";
}

function isDateInRange(date, from, to) {
  if (!date) {
    return false;
  }

  if (from && date < from) {
    return false;
  }

  if (to && date > to) {
    return false;
  }

  return true;
}

/* ============================================================
   SALES / QUANTITY
   ============================================================ */

function getSoldQuantity(assetId) {
  return (state.data.sales || [])
    .filter((sale) => sale.assetId === assetId)
    .reduce((sum, sale) => sum + normalizeNumber(sale.quantity), 0);
}

function getAvailableQuantity(assetId) {
  const asset = state.data.assets.find((item) => item.id === assetId);

  if (!asset) {
    return 0;
  }

  const hasReceivedMaturity =
    asset.type === "ovdp" &&
    (state.data.payments || []).some(
      (payment) =>
        payment.assetId === assetId &&
        payment.type === "MATURITY" &&
        (payment.status === "received" || payment.status === "paid"),
    );

  if (asset.closedAt || hasReceivedMaturity) {
    return 0;
  }

  const originalQuantity = normalizeNumber(asset.quantity);

  const soldQuantity = getSoldQuantity(assetId);

  return Math.max(0, originalQuantity - soldQuantity);
}

function getMaturityCostBasis(assetId) {
  const asset = state.data.assets.find((item) => item.id === assetId);

  return asset
    ? Math.max(0, normalizeNumber(asset.quantity) - getSoldQuantity(assetId)) *
      normalizeNumber(asset.purchasePrice)
    : 0;
}

/* ============================================================
   INVESTED
   ============================================================ */

function calculateInvested() {
  return state.data.assets.reduce((sum, asset) => {
    if (asset.type === "savings") return sum;
    const availableQuantity = getAvailableQuantity(asset.id);

    return sum + getAssetInvestedUah(asset, availableQuantity);
  }, 0);
}

function calculateInvestedUsd() {
  return state.data.assets.reduce((sum, asset) => {
    if (asset.type === "savings") return sum;
    return sum + getAssetInvestedUsd(asset, getAvailableQuantity(asset.id));
  }, 0);
}

function getCurrentPrice(asset) {
  const syncedPrice = normalizeNumber(asset.currentPrice);

  return syncedPrice > 0 ? syncedPrice : normalizeNumber(asset.purchasePrice);
}

function calculatePortfolioValue() {
  return state.data.assets.reduce(
    (sum, asset) => sum + (asset.type === "savings" ? 0 : toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency)),
    0,
  );
}

function isSaleTaxable(assetType) {
  return ["inzhur_reit", "s1_reit", "inzhur_miltech"].includes(assetType);
}

function profitAfterTax(profit, assetType) {
  return profit > 0 && isSaleTaxable(assetType)
    ? profit * (1 - CAPITAL_GAINS_TAX_RATE)
    : profit;
}

function getUnrealizedPriceGrowth(asset) {
  if (["savings", "novapay", "deposit"].includes(asset.type)) return 0;
  return getAvailableQuantity(asset.id) *
    (getCurrentPrice(asset) - normalizeNumber(asset.purchasePrice));
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderDashboard() {
  const invested = calculateInvested();
  const portfolioValue = calculatePortfolioValue();

  const investedElement = document.querySelector("#stat-invested");

  const valueElement = document.querySelector("#stat-value");

  const profitElement = document.querySelector("#stat-profit");

  const returnElement = document.querySelector("#stat-return");

  if (investedElement) {
    setDashboardCurrencyHover(investedElement, invested, calculateInvestedUsd());
  }

  if (valueElement) {
    setDashboardCurrencyHover(valueElement, portfolioValue);
  }

  /*
   * Realized sales profit
   */

  const salesProfit = (state.data.sales || []).reduce(
    (sum, sale) => sum + (sale.type === "savings" ? 0 : toUAH(profitAfterTax(normalizeNumber(sale.profit), sale.type), sale.currency)),
    0,
  );

  const priceGrowthProfit = state.data.assets.reduce(
    (sum, asset) => sum + toUAH(profitAfterTax(getUnrealizedPriceGrowth(asset), asset.type), asset.currency),
    0,
  );

  /*
   * Received payments
   */

  const receivedPayments = (state.data.payments || [])
    .filter(
      (payment) => payment.status === "received" || payment.status === "paid",
    )
    .reduce(
      (sum, payment) =>
        sum +
        toUAH(normalizeNumber(payment.amount) -
        (payment.type === "MATURITY" ? getMaturityCostBasis(payment.assetId) : 0), payment.currency),
      0,
    );

  const totalProfit = salesProfit + priceGrowthProfit + receivedPayments;

  if (profitElement) {
    setDashboardCurrencyHover(profitElement, totalProfit);
  }

  /*
   * ROI
   */

  const totalCostBasis = (state.data.sales || []).reduce(
    (sum, sale) => sum + (sale.type === "savings" ? 0 : toUAHPurchaseCost(normalizeNumber(sale.costBasis), sale.currency, sale.assetId, getAssetPurchaseDate(sale.assetId, sale.sellDate))),
    0,
  );

  if (returnElement) {
    const roiBase = invested + totalCostBasis;
    const roi = roiBase > 0 ? (totalProfit / roiBase) * 100 : 0;
    setReturnBenchmarkHover(returnElement, roi);
    renderReinvestmentForecast(totalProfit, roiBase);
  }

  /*
   * Dashboard assets
   */

  const assetsContainer = document.querySelector("#dashboard-assets");

  if (assetsContainer) {
    const activeAssets = state.data.assets.filter(
      (asset) => getAvailableQuantity(asset.id) > 0,
    );

    if (!activeAssets.length) {
      assetsContainer.className = "asset-list empty-state";

      assetsContainer.textContent = "No active assets.";
    } else {
      assetsContainer.className = "asset-list";

      const groupedAssets = Object.values(activeAssets.reduce((groups, asset) => {
        const key = `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
        groups[key] ||= { ...asset, _assets: [] };
        groups[key]._assets.push(asset);
        return groups;
      }, {}));

      assetsContainer.innerHTML = groupedAssets
        .map((asset) => {
          const available = asset._assets.reduce((sum, holding) => sum + getAvailableQuantity(holding.id), 0);
          const currencies = [...new Set(asset._assets.map((holding) => holding.currency || "UAH"))];
          const investedAsset = currencies.length === 1
            ? asset._assets.reduce((sum, holding) => sum + getAvailableQuantity(holding.id) * normalizeNumber(holding.purchasePrice), 0)
            : asset._assets.reduce((sum, holding) => sum + convertCurrency(getAvailableQuantity(holding.id) * normalizeNumber(holding.purchasePrice), holding.currency, "USD"), 0);
          const investedAssetUah = asset._assets.reduce(
            (sum, holding) => sum + getAssetInvestedUah(holding),
            0,
          );
          const displayCurrency = currencies.length === 1 ? currencies[0] : "USD";
          const assetIds = asset._assets.map((holding) => holding.id);

          return `
                        <div class="asset-row clickable-asset-row" data-asset-group="${escapeHtml(assetIds.join(","))}">

                            <div>
                                <div class="asset-name">
                                    ${escapeHtml(asset.name)}
                                </div>

                                <div class="asset-meta">
                                    ${
                                      typeLabels[asset.type] ||
                                      escapeHtml(asset.type)
                                    }

                                    · ${formatQuantity(available)} units
                                </div>
                            </div>

                            <div class="asset-amount">
                                ${portfolioMoneyWithUahHover(investedAsset, displayCurrency, investedAssetUah)}
                            </div>

                        </div>
                    `;
        })
        .join("");

      setupPortfolioCurrencyHover(assetsContainer);
    }
  }

  renderUpcomingPayments();
  assetsContainer?.querySelectorAll("[data-asset-group]").forEach((row) => row.addEventListener("click", () => openAssetTransactions(row.dataset.assetGroup.split(","))));
}

/* ============================================================
   UPCOMING PAYMENTS
   ============================================================ */

function renderUpcomingPayments() {
  const container = document.querySelector("#dashboard-payments");

  if (!container) {
    return;
  }

  const today = getDateString(new Date());

  const payments = groupPaymentEvents((state.data.payments || [])
    .filter(
      (payment) =>
        payment.date >= today &&
        payment.status !== "received" &&
        payment.status !== "paid",
    ))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 8);

  if (!payments.length) {
    container.className = "payment-list empty-state";

    container.textContent = "No upcoming payments.";

    return;
  }

  container.className = "payment-list";

  container.innerHTML = payments
    .map(
      (payment) => `
                    <div
                        class="payment-row"
                        data-payment-ids="${escapeHtml(payment.paymentIds.join(","))}"
                        style="cursor:pointer"
                    >

                        <div>

                            <div class="asset-name">
                                ${escapeHtml(payment.title)}
                            </div>

                            <div class="payment-meta">
                                ${formatDate(payment.date)}
                                ·
                                ${paymentTypeLabel(payment.type)}
                            </div>

                        </div>

                        <div class="payment-amount">
                            ${money(payment.amount, payment.currency)}
                        </div>

                    </div>
                `,
    )
    .join("");

  container.querySelectorAll("[data-payment-ids]").forEach((element) => {
    element.addEventListener("click", () => {
      const payment = payments.find(
        (item) => item.paymentIds.join(",") === element.dataset.paymentIds,
      );

      if (payment) {
        showCalendarEvent(payment);
      }
    });
  });
}

/* ============================================================
   PORTFOLIO
   ============================================================ */

function portfolioMoneyWithUahHover(value, currency = "UAH", valueInUah = null) {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  const original = money(value, normalizedCurrency);
  if (normalizedCurrency === "UAH") return original;
  const converted = money(Number.isFinite(valueInUah) ? valueInUah : toUAH(value, normalizedCurrency));
  return `<span class="portfolio-currency-hover" tabindex="0" data-original="${escapeHtml(original)}" data-uah="${escapeHtml(converted)}">${escapeHtml(original)}</span>`;
}

function setupPortfolioCurrencyHover(container) {
  container.querySelectorAll(".portfolio-currency-hover").forEach((element) => {
    const showUah = () => { element.textContent = element.dataset.uah; };
    const showOriginal = () => { element.textContent = element.dataset.original; };
    element.addEventListener("mouseenter", showUah);
    element.addEventListener("mouseleave", showOriginal);
    element.addEventListener("focus", showUah);
    element.addEventListener("blur", showOriginal);
  });
}

function renderPortfolio() {
  const tbody = document.querySelector("#portfolio-table");

  if (!tbody) {
    return;
  }

  if (!state.data.assets.length) {
    tbody.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    class="empty-state"
                >
                    No assets yet.
                </td>
            </tr>
        `;

    return;
  }

  const today = getDateString(new Date());

  const getNextPaymentDate = (assetId) =>
    (state.data.payments || [])
      .filter(
        (payment) =>
          payment.assetId === assetId &&
          payment.date >= today &&
          payment.status !== "received" &&
          payment.status !== "paid",
      )
      .map((payment) => payment.date)
      .sort()[0] || "9999-12-31";

  const rawAssets = state.data.assets
    .filter((asset) => getAvailableQuantity(asset.id) > 0)
    .sort((a, b) => {
      if (state.portfolioSort === "next-payment") {
        return getNextPaymentDate(a.id).localeCompare(getNextPaymentDate(b.id));
      }

      if (state.portfolioSort === "invested") {
        const aInvested = getAssetInvestedUah(a);
        const bInvested = getAssetInvestedUah(b);

        return bInvested - aInvested;
      }

      return String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || ""));
    });

  const assets = Object.values(rawAssets.reduce((groups, asset) => {
    const key = `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
    groups[key] ||= { ...asset, _assets: [] };
    groups[key]._assets.push(asset);
    return groups;
  }, {}));

  if (!assets.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">No active assets.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = assets
    .map((asset) => {
      const available = asset._assets.reduce((sum, item) => sum + getAvailableQuantity(item.id), 0);
      const currencies = [...new Set(asset._assets.map((item) => item.currency || "UAH"))];
      const displayCurrency = currencies.length === 1 ? currencies[0] : "USD";
      const invested = asset._assets.reduce((sum, item) => sum + convertCurrency(getAvailableQuantity(item.id) * normalizeNumber(item.purchasePrice), item.currency, displayCurrency), 0);
      const investedUah = asset._assets.reduce(
        (sum, item) => sum + getAssetInvestedUah(item),
        0,
      );
      const currentValue = asset._assets.reduce((sum, item) => sum + convertCurrency(getAvailableQuantity(item.id) * getCurrentPrice(item), item.currency, displayCurrency), 0);
      const averagePrice = available > 0 ? invested / available : 0;
      const averageCurrentPrice = available > 0 ? currentValue / available : averagePrice;
      const instruments = [...new Set(asset._assets.map((item) => item.instrumentName || "—"))];
      const assetIds = asset._assets.map((item) => item.id);

      return `
                    <tr class="clickable-asset-row" data-asset-group="${escapeHtml(assetIds.join(","))}">

                        <td>
                            <strong>
                                ${escapeHtml(asset.name)}
                            </strong>
                        </td>

                        <td>
                            ${typeLabels[asset.type] || escapeHtml(asset.type)}
                        </td>

                        <td>${escapeHtml(instruments.length === 1 ? instruments[0] : `${instruments.length} instruments`)}</td>

                        <td>
                            ${formatQuantity(available)}
                        </td>

                        <td>
                            ${portfolioMoneyWithUahHover(averagePrice, displayCurrency)}
                        </td>

                        <td>
                            ${asset.type === "savings" ? "—" : portfolioMoneyWithUahHover(averageCurrentPrice, displayCurrency)}
                        </td>

                        <td>
                            ${portfolioMoneyWithUahHover(invested, displayCurrency, investedUah)}
                        </td>

                        <td>
                            ${formatDate(asset.purchaseDate)}
                        </td>

                        <td>
    <div class="asset-actions">
    
        <button
    type="button"
    class="secondary-btn"
    data-buy-assets="${escapeHtml(assetIds.join(","))}"
>
    Buy
</button>

        <button
            type="button"
            class="secondary-btn"
            data-edit-assets="${escapeHtml(assetIds.join(","))}"
        >
            Edit
        </button>

        <button
            type="button"
            class="danger-btn"
            data-delete-assets="${escapeHtml(assetIds.join(","))}"
        >
            Delete
        </button>

    </div>
</td>

                    </tr>
                `;
    })
    .join("");

  setupPortfolioCurrencyHover(tbody);

  tbody.querySelectorAll("[data-buy-assets]").forEach((button) => {
    button.addEventListener("click", () => {
      openHoldingSelectionModal(button.dataset.buyAssets.split(","), "buy");
    });
  });

  tbody.querySelectorAll("[data-edit-assets]").forEach((button) => {
    button.addEventListener("click", () => {
      openHoldingSelectionModal(button.dataset.editAssets.split(","), "edit");
    });
  });

  tbody.querySelectorAll("[data-delete-assets]").forEach((button) => {
    button.addEventListener("click", () => {
      openHoldingSelectionModal(button.dataset.deleteAssets.split(","), "delete");
    });
  });

  tbody.querySelectorAll("[data-asset-group]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openAssetTransactions(row.dataset.assetGroup.split(","));
  }));
}

function openAssetTransactions(assetIds) {
  state.assetDetailIds = assetIds;
  const assets = state.data.assets.filter((asset) => assetIds.includes(asset.id));
  document.querySelector("#asset-transactions-title").textContent = assets[0]?.name || "Transactions";
  document.querySelector("#asset-hide-sales").checked = false;
  document.querySelector("#asset-only-current").checked = false;
  renderAssetTransactionsModal();
  document.querySelector("#asset-transactions-modal").classList.add("open");
}

function renderAssetTransactionsModal() {
  const body = document.querySelector("#asset-transactions-body");
  const ids = state.assetDetailIds || [];
  if (!body) return;
  const hideSales = document.querySelector("#asset-hide-sales")?.checked;
  const onlyCurrent = document.querySelector("#asset-only-current")?.checked;
  if (onlyCurrent) {
    const holdings = state.data.assets.filter((asset) => ids.includes(asset.id) && getAvailableQuantity(asset.id) > 0);
    body.innerHTML = holdings.length ? holdings.map((asset) => `<tr><td>${formatDate(asset.purchaseDate)}</td><td>${escapeHtml(asset.instrumentName || "—")} — ${escapeHtml(asset.instrumentType || "")}</td><td>AVAILABLE</td><td>${getAvailableQuantity(asset.id)}</td><td>${money(getAvailableQuantity(asset.id) * asset.purchasePrice, asset.currency)}</td><td><button class="secondary-btn" data-detail-edit="${escapeHtml(asset.id)}">Edit</button> <button class="danger-btn" data-detail-delete="${escapeHtml(asset.id)}">Delete</button></td></tr>`).join("") : '<tr><td colspan="6" class="empty-state">No current holdings.</td></tr>';
    body.querySelectorAll("[data-detail-edit]").forEach((button) => button.addEventListener("click", () => openEditAssetModal(button.dataset.detailEdit)));
    body.querySelectorAll("[data-detail-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!(await showConfirm("Delete this holding and all related records?"))) return;
      await api.deleteAsset(button.dataset.detailDelete);
      document.querySelector("#asset-transactions-modal")?.classList.remove("open");
      await loadData();
    }));
    return;
  }
  let transactions = (state.data.transactions || []).filter((transaction) => ids.includes(transaction.assetId));
  if (hideSales) transactions = transactions.filter((transaction) => transaction.type === "BUY");
  transactions.sort((a, b) => String(getTransactionEffectiveDate(b) || "").localeCompare(String(getTransactionEffectiveDate(a) || "")));
  body.innerHTML = transactions.length ? transactions.map((transaction) => {
    const asset = state.data.assets.find((item) => item.id === transaction.assetId);
    return `<tr><td>${formatDate(getTransactionEffectiveDate(transaction))}</td><td>${escapeHtml(asset?.instrumentName || "—")}</td><td>${escapeHtml(transaction.type)}</td><td>${transaction.quantity ?? "—"}</td><td>${money(transaction.amount, transaction.currency || asset?.currency)}</td><td></td></tr>`;
  }).join("") : '<tr><td colspan="6" class="empty-state">No matching transactions.</td></tr>';
}

function setupAssetTransactionsModal() {
  const modal = document.querySelector("#asset-transactions-modal");
  document.querySelector("#close-asset-transactions")?.addEventListener("click", () => modal?.classList.remove("open"));
  document.querySelector("#asset-hide-sales")?.addEventListener("change", renderAssetTransactionsModal);
  document.querySelector("#asset-only-current")?.addEventListener("change", renderAssetTransactionsModal);
}

function holdingOptionLabel(asset) {
  const available = getAvailableQuantity(asset.id);
  const instrument = asset.instrumentName || "No instrument";
  const instrumentType = asset.instrumentType ? ` · ${asset.instrumentType}` : "";
  return `${asset.name} — ${instrument}${instrumentType} — ${formatQuantity(available)} units`;
}

function groupHoldingsByInstrument(holdings) {
  return Object.values(holdings.reduce((groups, asset) => {
    const instrumentName = String(asset.instrumentName || "No instrument").trim();
    const instrumentType = String(asset.instrumentType || "").trim();
    const currency = String(asset.currency || "UAH").toUpperCase();
    const key = `${instrumentName.toLowerCase()}::${instrumentType.toLowerCase()}::${currency}`;
    groups[key] ||= { assets: [], instrumentName, instrumentType, currency };
    groups[key].assets.push(asset);
    return groups;
  }, {}));
}

function holdingGroupLabel(group) {
  const first = group.assets[0];
  const quantity = group.assets.reduce((sum, asset) => sum + getAvailableQuantity(asset.id), 0);
  const instrumentType = group.instrumentType ? ` · ${group.instrumentType}` : "";
  return `${first.name} — ${group.instrumentName}${instrumentType} · ${group.currency} — ${formatQuantity(quantity)} units`;
}

async function executeHoldingAction(assetIds, action) {
  const assets = state.data.assets.filter((asset) => assetIds.includes(asset.id));
  if (!assets.length) return showNotice("Holding not found.");
  if (action === "buy") {
    openBuyMoreModal(assets[0].id);
    return;
  }
  if (action === "edit") {
    openEditAssetModal(assets.map((asset) => asset.id));
    return;
  }
  const group = groupHoldingsByInstrument(assets)[0];
  const confirmed = await showConfirm(
    `Delete ${holdingGroupLabel(group)} and all related payments, transactions and sales?`,
    "Confirm deletion",
  );
  if (!confirmed) return;
  try {
    for (const asset of assets) await api.deleteAsset(asset.id);
    await loadData();
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Failed to delete holding.");
  }
}

function openHoldingSelectionModal(assetIds, action) {
  const holdings = state.data.assets.filter((asset) => assetIds.includes(asset.id) && getAvailableQuantity(asset.id) > 0);
  if (!holdings.length) return showNotice("No available holdings found.");
  const instrumentGroups = groupHoldingsByInstrument(holdings);
  if (instrumentGroups.length === 1) {
    executeHoldingAction(instrumentGroups[0].assets.map((asset) => asset.id), action);
    return;
  }
  const modal = document.querySelector("#delete-holding-modal");
  const select = document.querySelector("#delete-holding-asset");
  if (!modal || !select) return;
  state.holdingSelectionAction = action;
  select.innerHTML = instrumentGroups.map((group) => `<option value="${escapeHtml(group.assets.map((asset) => asset.id).join(","))}">${escapeHtml(holdingGroupLabel(group))}</option>`).join("");
  document.querySelector("#holding-selection-title").textContent = action === "buy" ? "Buy holding" : action === "edit" ? "Edit holding" : "Delete holding";
  const submit = document.querySelector("#holding-selection-submit");
  submit.textContent = action === "buy" ? "Buy" : action === "edit" ? "Edit" : "Delete";
  submit.className = action === "delete" ? "danger-btn" : "primary-btn";
  modal.classList.add("open");
}

function setupDeleteHoldingModal() {
  const modal = document.querySelector("#delete-holding-modal");
  const form = document.querySelector("#delete-holding-form");
  const close = () => modal?.classList.remove("open");
  document.querySelector("#close-delete-holding-modal")?.addEventListener("click", close);
  document.querySelector("#cancel-delete-holding")?.addEventListener("click", close);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const assetIds = String(document.querySelector("#delete-holding-asset")?.value || "").split(",").filter(Boolean);
    if (!assetIds.length) return showNotice("Please select a holding.");
    close();
    await executeHoldingAction(assetIds, state.holdingSelectionAction);
  });
}

/* ============================================================
   TRANSACTIONS
   ============================================================ */

function getTransactionEffectiveDate(transaction) {
  if (!transaction?.paymentId) return transaction?.date;
  const payment = (state.data.payments || []).find((item) => item.id === transaction.paymentId);
  return payment?.receivedDate || String(payment?.receivedAt || "").slice(0, 10) || transaction.date;
}

function renderTransactions() {
  const tbody = document.querySelector("#transactions-table");

  if (!tbody) {
    return;
  }

  const paymentTransactionIds = new Set(
    (state.data.transactions || [])
      .filter((transaction) => transaction.paymentId)
      .map((transaction) => transaction.paymentId),
  );

  const receivedPaymentTransactions = (state.data.payments || [])
    .filter(
      (payment) =>
        (payment.status === "received" || payment.status === "paid") &&
        !paymentTransactionIds.has(payment.id),
    )
    .map((payment) => ({
      id: `payment-transaction-${payment.id}`,
      paymentId: payment.id,
      date: payment.receivedDate || String(payment.receivedAt || "").slice(0, 10) || payment.date,
      assetId: payment.assetId,
      assetName: payment.assetName,
      type: payment.type,
      quantity: null,
      amount: normalizeNumber(payment.amount),
      currency: payment.currency,
      isPayment: true,
    }));

  const transactions = [
    ...(state.data.transactions || []),
    ...receivedPaymentTransactions,
  ].sort((a, b) =>
    String(getTransactionEffectiveDate(b) || "").localeCompare(String(getTransactionEffectiveDate(a) || "")),
  );

  if (!transactions.length) {
    tbody.innerHTML = `
            <tr>
                <td
                    colspan="7"
                    class="empty-state"
                >
                    No transactions yet.
                </td>
            </tr>
        `;

    return;
  }

  tbody.innerHTML = transactions
    .map((tx) => {
      const isSale = tx.type === "SELL";
      const isPayment = tx.isPayment || ["DIVIDEND", "COUPON", "MATURITY"].includes(tx.type);

      const paymentProfit = ["DIVIDEND", "COUPON"].includes(tx.type)
        ? normalizeNumber(tx.amount)
        : tx.type === "MATURITY"
          ? normalizeNumber(tx.amount) - getMaturityCostBasis(tx.assetId)
          : 0;
      const profit = tx.isPayment || ["DIVIDEND", "COUPON", "MATURITY"].includes(tx.type)
        ? paymentProfit
        : normalizeNumber(tx.profit);

      const costBasis = normalizeNumber(tx.costBasis);

      const roi = isSale && costBasis > 0 ? (profit / costBasis) * 100 : 0;

      return `
                    <tr>

                        <td>
                            ${formatDate(getTransactionEffectiveDate(tx))}
                        </td>

                        <td>
                            <strong>
                                ${escapeHtml(tx.assetName || "-")}
                            </strong>
                        </td>

                        <td>
                            ${
                              isSale
                                ? `
                                        <span class="transaction-sale">
                                            SELL
                                        </span>
                                    `
                                : isPayment
                                  ? paymentTypeLabel(tx.type)
                                  : escapeHtml(tx.type || "-")
                            }
                        </td>

                        <td>
                            ${tx.quantity ?? "-"}
                        </td>

                        <td>
                            ${
                              tx.amount != null
                                ? money(tx.amount, tx.currency)
                                : "-"
                            }
                        </td>

                        <td>
                            ${
                              isSale || isPayment
                                ? `
                                        <span class="${
                                          profit >= 0 ? "positive" : "negative"
                                        }">
                                            ${profit >= 0 ? "+" : ""}${money(
                                              profit,
                                              tx.currency,
                                            )}
                                        </span>
                                    `
                                : "-"
                            }
                        </td>

                        <td>
                            ${isSale ? `${roi.toFixed(2)}%` : isPayment && getMaturityCostBasis(tx.assetId) > 0 ? `${((profit / getMaturityCostBasis(tx.assetId)) * 100).toFixed(2)}%` : "-"}
                        </td>

                    </tr>
                `;
    })
    .join("");
}

/* ============================================================
   CALENDAR
   ============================================================ */

function renderCalendar() {
  const title = document.querySelector("#calendar-month-title");

  const grid = document.querySelector("#calendar-grid");

  if (!title || !grid) {
    return;
  }

  const year = state.calendarDate.getFullYear();

  const month = state.calendarDate.getMonth();

  title.textContent = `${monthNames[month]} ${year}`;

  grid.innerHTML = "";

  const firstDay = new Date(year, month, 1);

  let startDay = firstDay.getDay();

  /*
   * Convert Sunday = 0
   * to Sunday = 7
   */

  if (startDay === 0) {
    startDay = 7;
  }

  const daysInPreviousMonth = new Date(year, month, 0).getDate();

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = getDateString(new Date());

  const events = getCalendarEvents();

  /*
   * 6 weeks = 42 cells
   */

  for (let cell = 1; cell <= 42; cell++) {
    const dayElement = document.createElement("div");

    dayElement.className = "calendar-day";

    let date;
    let dayNumber;

    /*
     * Previous month
     */

    if (cell < startDay) {
      dayNumber = daysInPreviousMonth - startDay + cell;

      date = new Date(year, month - 1, dayNumber);

      dayElement.classList.add("other-month");
    } else if (cell >= startDay + daysInMonth) {

    /*
     * Next month
     */
      dayNumber = cell - startDay - daysInMonth + 1;

      date = new Date(year, month + 1, dayNumber);

      dayElement.classList.add("other-month");
    } else {

    /*
     * Current month
     */
      dayNumber = cell - startDay + 1;

      date = new Date(year, month, dayNumber);
    }

    const dateString = getDateString(date);

    if (dateString === today) {
      dayElement.classList.add("today");
    }

    const number = document.createElement("div");

    number.className = "calendar-day-number";

    number.textContent = dayNumber;

    dayElement.appendChild(number);

    const eventsContainer = document.createElement("div");

    eventsContainer.className = "calendar-events";

    const dayEvents = events.filter((event) => event.date === dateString);

    dayEvents.slice(0, 5).forEach((event) => {
      const eventButton = document.createElement("button");

      eventButton.type = "button";

      eventButton.className = `calendar-event ${event.category}`;

      if (
        event.source === "payment" &&
        (event.status === "received" || event.status === "paid")
      ) {
        eventButton.classList.add("received");
      }

      eventButton.innerHTML = `
                    <div
                        class="calendar-event-title"
                    >
                        ${escapeHtml(event.title)}
                    </div>

                    ${
                      event.amount != null && normalizeNumber(event.amount) > 0
                        ? `
                                <div
                                    class="calendar-event-amount"
                                >
                                    ${money(event.amount, event.currency)}
                                </div>
                            `
                        : ""
                    }

                    ${
                      event.source === "payment" &&
                      (event.status === "received" || event.status === "paid")
                        ? `
                                <div class="calendar-event-status">
                                    Received
                                </div>
                            `
                        : ""
                    }
                `;

      eventButton.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();

        showCalendarEvent(event);
      });

      eventsContainer.appendChild(eventButton);
    });

    if (dayEvents.length > 5) {
      const more = document.createElement("div");

      more.className = "calendar-event";

      more.textContent = `+ ${dayEvents.length - 5} more`;

      eventsContainer.appendChild(more);
    }

    dayElement.appendChild(eventsContainer);

    /*
     * Double-click day
     * -> planned purchase note
     */

    dayElement.addEventListener("dblclick", () => {
      openNoteModal(dateString);
    });

    grid.appendChild(dayElement);
  }
}

/* ============================================================
   CALENDAR EVENTS
   ============================================================ */

function getCalendarEvents() {
  const paymentEvents = groupPaymentEvents(state.data.payments || []);

  const noteEvents = (state.data.calendarNotes || []).map((note) => ({
    id: note.id,
    source: "note",
    date: note.date,
    category: "note",
    title: note.assetName || "Planned purchase",
    amount: note.amount,
    currency: note.currency || "UAH",
    type: "PLANNED_PURCHASE",
    text: note.text,
    assetId: note.assetId,
  }));

  return [...paymentEvents, ...noteEvents];
}

function paymentToCalendarEvent(payment) {
    let category = "coupon";

    if (payment.type === "DIVIDEND") {
      category = "dividend";
    }

    if (payment.type === "MATURITY") {
      category = "maturity";
    }

    return {
      id: payment.id,
      paymentIds: payment.paymentIds || [payment.id],

      source: "payment",

      date: payment.date,

      category,

      title: payment.assetName,

      amount: payment.amount,

      currency: payment.currency,

      type: payment.type,

      assetId: payment.assetId,

      status: payment.status,
    };
}

function groupPaymentEvents(payments) {
  const groups = new Map();
  payments.forEach((payment) => {
    const asset = (state.data.assets || []).find((item) => item.id === payment.assetId);
    const assetName = String(asset?.name || payment.assetName || "Payment").trim();
    const assetType = asset?.type || "";
    const statusGroup = payment.status === "received" || payment.status === "paid" ? "received" : "planned";
    const key = [payment.date, payment.type, payment.currency || "UAH", assetType, assetName.toLocaleLowerCase(), statusGroup].join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.amount += normalizeNumber(payment.amount);
      existing.paymentIds.push(payment.id);
    } else {
      groups.set(key, paymentToCalendarEvent({ ...payment, assetName, paymentIds: [payment.id] }));
    }
  });
  return [...groups.values()];
}

/* ============================================================
   EVENT MODAL
   ============================================================ */

function showCalendarEvent(event) {
  const modal = document.querySelector("#event-modal");

  const title = document.querySelector("#event-modal-title");

  const content = document.querySelector("#event-modal-content");

  if (!modal || !title || !content) {
    return;
  }

  title.textContent = event.title || "Event";

  let html = `
        <div class="event-details">

            <div class="event-detail">

                <div class="event-detail-label">
                    Date
                </div>

                <div class="event-detail-value">
                    ${formatDate(event.date)}
                </div>

            </div>


            <div class="event-detail">

                <div class="event-detail-label">
                    Type
                </div>

                <div class="event-detail-value">
                    ${
                      event.source === "note"
                        ? "Planned purchase"
                        : paymentTypeLabel(event.type)
                    }
                </div>

            </div>
    `;

  /*
   * Amount
   */

  if (event.amount != null && normalizeNumber(event.amount) > 0) {
    html += `
            <div class="event-detail">

                <div class="event-detail-label">
                    Amount
                </div>

                <div class="event-detail-value">
                    ${money(event.amount, event.currency)}
                </div>

            </div>
        `;
  }

  /*
   * Payment status
   */

  if (event.source === "payment") {
    html += `
            <div class="event-detail">

                <div class="event-detail-label">
                    Status
                </div>

                <div class="event-detail-value">
                    ${
                      event.status === "received" || event.status === "paid"
                        ? "Received"
                        : "Planned"
                    }
                </div>

            </div>
        `;
  }

  /*
   * Note text
   */

  if (event.source === "note" && event.text) {
    html += `
            <div class="event-detail">

                <div class="event-detail-label">
                    Note
                </div>

                <div class="event-detail-value">
                    ${escapeHtml(event.text)}
                </div>

            </div>
        `;
  }

  /*
   * Mark as received
   *
   * Only for actual payments.
   */

  if (
    event.source === "payment" &&
    event.status !== "received" &&
    event.status !== "paid"
  ) {
    html += `
            <div
                class="event-action"
                style="margin-top:20px;"
            >

                <button
                    type="button"
                    class="primary-btn"
                    id="mark-payment-received"
                >
                    Mark as received
                </button>

            </div>
        `;
  }

  /*
   * Already received
   */

  if (
    event.source === "payment" &&
    (event.status === "received" || event.status === "paid")
  ) {
    html += `
            <div
                class="event-action"
                style="margin-top:20px;"
            >

                <div class="positive">
                    ✓ Payment received
                </div>

            </div>
        `;
  }

  html += `
        </div>
    `;

  content.innerHTML = html;

  /*
   * Mark received button
   */

  const markReceivedButton = document.querySelector("#mark-payment-received");

  if (markReceivedButton) {
    markReceivedButton.addEventListener("click", async () => {
      await markPaymentAsReceived(event.paymentIds || [event.id], markReceivedButton);
    });
  }

  modal.classList.add("open");
}

/* ============================================================
   MARK PAYMENT AS RECEIVED
   ============================================================ */

async function markPaymentAsReceived(paymentIds, button = null) {
  const ids = Array.isArray(paymentIds) ? paymentIds : [paymentIds];
  const payments = ids.map((id) => state.data.payments.find((item) => item.id === id)).filter(Boolean);

  if (!payments.length) {
    showNotice("Payment not found.");

    return;
  }

  if (payments.every((payment) => payment.status === "received" || payment.status === "paid")) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  try {
    /*
     * This endpoint must exist
     * on server.js:
     *
     * PATCH /api/payments/:id/received
     */

    for (const payment of payments) {
      if (payment.status === "received" || payment.status === "paid") continue;
      await api.markPaymentReceived(payment.id);
    }

    /*
     * Reload data from JSON
     */

    await loadData();

    /*
     * Close event modal
     */

    const modal = document.querySelector("#event-modal");

    if (modal) {
      modal.classList.remove("open");
    }

    /*
     * Re-render everything
     */

    renderDashboard();
    renderCalendar();
    renderProfitCalculator();
  } catch (error) {
    console.error("MARK PAYMENT RECEIVED ERROR:", error);

    showNotice(error.message || "Failed to mark payment as received.");

    if (button) {
      button.disabled = false;

      button.textContent = "Mark as received";
    }
  }
}

/* ============================================================
   EVENT MODAL SETUP
   ============================================================ */

function setupEventModal() {
  const modal = document.querySelector("#event-modal");

  if (!modal) {
    return;
  }

  const close = () => {
    modal.classList.remove("open");
  };

  const closeButton = document.querySelector("#close-event-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  const closeButton2 = document.querySelector("#event-modal-close-btn");

  if (closeButton2) {
    closeButton2.addEventListener("click", close);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });
}

/* ============================================================
   CALENDAR NAVIGATION
   ============================================================ */

function setupCalendarNavigation() {
  const previous = document.querySelector("#previous-month");

  const next = document.querySelector("#next-month");

  const today = document.querySelector("#today-btn");

  if (previous) {
    previous.addEventListener("click", () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);

      renderCalendar();
    });
  }

  if (next) {
    next.addEventListener("click", () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);

      renderCalendar();
    });
  }

  if (today) {
    today.addEventListener("click", () => {
      state.calendarDate = new Date();

      renderCalendar();
    });
  }
}

/* ============================================================
   NOTE MODAL
   ============================================================ */

function populateAssetSelect() {
  const select = document.querySelector("#note-asset");

  if (!select) {
    return;
  }

  select.innerHTML = `
        <option value="">
            Select asset
        </option>
    `;

  state.data.assets.forEach((asset) => {
    const option = document.createElement("option");

    option.value = asset.id;

    option.textContent = asset.name;

    select.appendChild(option);
  });
}

function openNoteModal(date = null) {
  const modal = document.querySelector("#note-modal");

  const dateInput = document.querySelector("#note-date");

  const textInput = document.querySelector("#note-text");

  if (!modal || !dateInput || !textInput) {
    return;
  }

  populateAssetSelect();

  dateInput.value = date || getDateString(new Date());

  textInput.value = "";

  const amountInput = document.querySelector('#note-form [name="amount"]');

  if (amountInput) {
    amountInput.value = "";
  }

  modal.classList.add("open");
}

function setupNoteModal() {
  const modal = document.querySelector("#note-modal");

  if (!modal) {
    return;
  }

  const close = () => {
    modal.classList.remove("open");
  };

  const addButton = document.querySelector("#add-note-btn");

  if (addButton) {
    addButton.addEventListener("click", () => openNoteModal());
  }

  const closeButton = document.querySelector("#close-note-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  const cancelButton = document.querySelector("#cancel-note");

  if (cancelButton) {
    cancelButton.addEventListener("click", close);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  const form = document.querySelector("#note-form");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    const assetId = formData.get("assetId");

    const asset = state.data.assets.find((item) => item.id === assetId);

    const note = {
      date: formData.get("date"),

      assetId,

      assetName: asset?.name || "Planned purchase",

      text: String(formData.get("text") || "").trim(),

      amount: normalizeNumber(formData.get("amount")),

      currency: asset?.currency || "UAH",
    };

    if (!note.date || !note.assetId || !note.text) {
      showNotice("Please fill in all required fields.");

      return;
    }

    try {
      await api.createCalendarNote(note);

      close();

      await loadData();
    } catch (error) {
      console.error(error);

      showNotice(error.message || "Failed to save note.");
    }
  });
}

/* ============================================================
   ASSET MODAL
   ============================================================ */

function openEditAssetModal(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const assets = state.data.assets.filter((item) => ids.includes(item.id));
  const firstAsset = assets[0];
  const totalQuantity = assets.reduce((sum, item) => sum + normalizeNumber(item.quantity), 0);
  const totalCost = assets.reduce((sum, item) => sum + normalizeNumber(item.quantity) * normalizeNumber(item.purchasePrice), 0);
  const totalCurrentValue = assets.reduce((sum, item) => sum + normalizeNumber(item.quantity) * getCurrentPrice(item), 0);
  const asset = firstAsset && assets.length > 1 ? {
    ...firstAsset,
    quantity: totalQuantity,
    purchasePrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
    currentPrice: totalQuantity > 0 ? totalCurrentValue / totalQuantity : firstAsset.currentPrice,
    purchaseDate: assets.map((item) => item.purchaseDate).filter(Boolean).sort()[0] || firstAsset.purchaseDate,
    firstDividendDate: assets.map((item) => item.firstDividendDate).filter(Boolean).sort()[0] || firstAsset.firstDividendDate,
  } : firstAsset;

  if (!asset) {
    showNotice("Asset not found.");
    return;
  }

  const modal = document.querySelector("#asset-modal");

  const form = document.querySelector("#asset-form");

  if (!modal || !form) {
    return;
  }

  state.editingAssetId = asset.id;
  state.editingAssetIds = assets.map((item) => item.id);

  /*
   * Modal title
   */

  const modalTitle = modal.querySelector(".modal-header h2");

  if (modalTitle) {
    modalTitle.textContent = "Edit asset";
  }

  /*
   * Submit button
   */

  const submitButton = form.querySelector('button[type="submit"]');

  if (submitButton) {
    submitButton.textContent = "Save changes";
  }

  /*
   * Basic fields
   */

  form.elements.name.value = asset.name || "";

  form.elements.type.value = asset.type || "ovdp";

  form.elements.currency.value = asset.currency || "UAH";

  form.elements.quantity.value = asset.quantity ?? "";

  form.elements.purchasePrice.value = asset.purchasePrice ?? "";

  form.elements.purchaseDate.value = asset.purchaseDate || "";
  populateInstrumentSelect(asset.instrumentName || "");
  if (form.elements.termMonths) form.elements.termMonths.value = asset.termMonths || 1;
  if (form.elements.novapayMaturityDate) form.elements.novapayMaturityDate.value = asset.type === "novapay" ? asset.maturityDate || "" : "";
  if (form.elements.maturityAmount) form.elements.maturityAmount.value = asset.maturityAmount || "";
  if (form.elements.annualRate) form.elements.annualRate.value = asset.annualRate ?? "";
  if (form.elements.depositMaturityDate) form.elements.depositMaturityDate.value = asset.type === "deposit" ? asset.maturityDate || "" : "";
  if (form.elements.earlyWithdrawal) form.elements.earlyWithdrawal.checked = Boolean(asset.earlyWithdrawal);

  /*
   * Update visible settings
   */

  updateAssetTypeFields();

  /*
   * REIT
   */

  const dividendInput = document.querySelector("#dividend-per-unit");

  const firstDividendInput = document.querySelector("#first-dividend-date");

  const s1CurrentPriceField = document.querySelector("#s1-current-price-field");

  const currentPriceInput = document.querySelector("#s1-current-price");

  if (dividendInput) {
    dividendInput.value = asset.dividendPerUnit ?? "";
  }

  if (firstDividendInput) {
    firstDividendInput.value = asset.firstDividendDate || "";
  }

  if (currentPriceInput) {
    currentPriceInput.value = asset.currentPrice ?? "";
  }

  /*
   * OVDP
   */

  const maturityInput = document.querySelector("#maturity-date");
  const isinInput = document.querySelector("#asset-isin");

  if (maturityInput) {
    maturityInput.value = asset.maturityDate || "";
  }

  if (isinInput) {
    isinInput.value = asset.isin || "";
  }

  const couponList = document.querySelector("#coupon-list");

  if (couponList) {
    couponList.innerHTML = "";

    if (asset.type === "ovdp" && Array.isArray(asset.coupons)) {
      asset.coupons.forEach((coupon) => {
        addCouponRow(coupon);
      });
    }
  }

  modal.classList.add("open");
}

function setupModal() {
  const modal = document.querySelector("#asset-modal");

  const form = document.querySelector("#asset-form");

  /*
   * Never allow a missing modal
   * to crash the whole application.
   */

  if (!modal || !form) {
    console.warn("Asset modal or form was not found.");

    return;
  }

  /*
   * We handle validation ourselves.
   * This prevents hidden fields from
   * blocking submit.
   */

  form.noValidate = true;
  populateInstrumentSelect();
  document.querySelector("#asset-instrument")?.addEventListener("change", updateNewInstrumentFields);
  const updateNovaPayDate = () => {
    if (form.elements.type?.value !== "novapay" || !form.elements.purchaseDate?.value) return;
    const date = new Date(`${form.elements.purchaseDate.value}T00:00:00`);
    date.setMonth(date.getMonth() + Math.max(1, normalizeNumber(form.elements.termMonths?.value)));
    form.elements.novapayMaturityDate.value = getDateString(date);
  };
  form.elements.termMonths?.addEventListener("input", updateNovaPayDate);
  form.elements.purchaseDate?.addEventListener("change", updateNovaPayDate);

  /*
   * ==========================================================
   * HELPERS
   * ==========================================================
   */

  const getInput = (name) => form.querySelector(`[name="${name}"]`);

  const setValue = (name, value) => {
    const input = getInput(name);

    if (input) {
      input.value = value ?? "";
    }
  };

  const setModalMode = (mode) => {
    const modalTitle = modal.querySelector(".modal-header h2");

    const submitButton = form.querySelector('button[type="submit"]');

    if (mode === "edit") {
      if (modalTitle) {
        modalTitle.textContent = "Edit asset";
      }

      if (submitButton) {
        submitButton.textContent = "Save changes";
      }
    } else {
      if (modalTitle) {
        modalTitle.textContent = "Add asset";
      }

      if (submitButton) {
        submitButton.textContent = "Save asset";
      }
    }
  };

  /*
   * Clear coupon rows.
   */

  const clearCoupons = () => {
    const couponList = document.querySelector("#coupon-list");

    if (couponList) {
      couponList.innerHTML = "";
    }
  };

  /*
   * Reset the complete form.
   */

  const resetAssetForm = () => {
    form.reset();
    populateInstrumentSelect();

    clearCoupons();

    /*
     * Reset editing state.
     */

    state.editingAssetId = null;
    state.editingAssetIds = [];

    setModalMode("add");

    /*
     * Update dynamic fields
     * according to default type.
     */

    updateAssetTypeFields();

    /*
     * Set default dates.
     */

    setDefaultDates();

    /*
     * If default type is OVDP,
     * create the first coupon row.
     */

    const currentType = getInput("type")?.value;

    if (currentType === "ovdp") {
      addCouponRow();
    }
  };

  /*
   * ==========================================================
   * OPEN ADD MODAL
   * ==========================================================
   */

  const openAddModal = () => {
    /*
     * Make sure no previous
     * editing state remains.
     */

    state.editingAssetId = null;
    state.editingAssetIds = [];

    /*
     * Completely reset form.
     */

    form.reset();
    populateInstrumentSelect();

    clearCoupons();

    setModalMode("add");

    /*
     * Update fields first.
     */

    updateAssetTypeFields();

    /*
     * Set default dates.
     */

    setDefaultDates();

    /*
     * Add first coupon
     * for OVDP.
     */

    const currentType = getInput("type")?.value;

    if (currentType === "ovdp") {
      addCouponRow();
    }

    /*
     * Open modal.
     */

    modal.classList.add("open");
  };

  /*
   * ==========================================================
   * OPEN EDIT MODAL
   * ==========================================================
   */

  const openEditModal = (asset) => {
    if (!asset) {
      console.warn("Cannot edit missing asset.");

      return;
    }

    /*
     * Store ID of asset being edited.
     */

    state.editingAssetId = asset.id;

    /*
     * Reset form before
     * filling existing data.
     */

    form.reset();

    clearCoupons();

    /*
     * Change modal title
     * and submit button.
     */

    setModalMode("edit");

    /*
     * ======================================================
     * BASIC DATA
     * ======================================================
     */

    setValue("name", asset.name);

    setValue("type", asset.type);

    setValue("currency", asset.currency || "UAH");

    setValue("quantity", asset.quantity);

    setValue("purchasePrice", asset.purchasePrice);

    setValue("purchaseDate", asset.purchaseDate);

    /*
     * Update dynamic fields
     * after setting asset type.
     */

    updateAssetTypeFields();

    /*
     * ======================================================
     * REIT
     * ======================================================
     */

    if (asset.type === "inzhur_reit" || asset.type === "s1_reit") {
      setValue("dividendPerUnit", asset.dividendPerUnit);

      setValue("firstDividendDate", asset.firstDividendDate);
    }

    /*
     * ======================================================
     * OVDP
     * ======================================================
     */

    if (asset.type === "ovdp") {
      setValue("maturityDate", asset.maturityDate);

      /*
       * Recreate all coupon rows
       * from saved data.
       */

      const coupons = Array.isArray(asset.coupons) ? asset.coupons : [];

      if (coupons.length) {
        coupons.forEach((coupon) => {
          addCouponRow(coupon);
        });
      } else {
        /*
         * If old asset has no coupons,
         * create one empty row.
         */

        addCouponRow();
      }
    }

    /*
     * ======================================================
     * OPEN MODAL
     * ======================================================
     */

    modal.classList.add("open");
  };

  /*
   * Expose edit function so that
   * portfolio rendering can use it.
   *
   * Example:
   *
   * openEditAsset(asset)
   */

  window.openEditAsset = openEditModal;

  /*
   * ==========================================================
   * CLOSE MODAL
   * ==========================================================
   */

  const close = () => {
    modal.classList.remove("open");
  };

  /*
   * ==========================================================
   * HEADER ADD ASSET
   * ==========================================================
   */

  const addButton = document.querySelector("#add-asset-btn");

  if (addButton) {
    addButton.addEventListener("click", (event) => {
      event.preventDefault();

      openAddModal();
    });
  }

  /*
   * ==========================================================
   * PORTFOLIO ADD ASSET
   * ==========================================================
   */

  /*
   * ==========================================================
   * CLOSE BUTTON
   * ==========================================================
   */

  const closeButton = document.querySelector("#close-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  /*
   * ==========================================================
   * CANCEL BUTTON
   * ==========================================================
   */

  const cancelButton = document.querySelector("#cancel-modal");

  if (cancelButton) {
    cancelButton.addEventListener("click", close);
  }

  /*
   * ==========================================================
   * CLICK OUTSIDE MODAL
   * ==========================================================
   */

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  /*
   * ==========================================================
   * ASSET TYPE
   * ==========================================================
   */

  const assetType = document.querySelector("#asset-type");

  if (assetType) {
    assetType.addEventListener("change", () => {
      updateAssetTypeFields();
      updateNovaPayDate();

      /*
       * When switching to OVDP
       * during Add/Edit, make sure
       * there is at least one coupon row.
       */

      if (assetType.value === "ovdp") {
        const couponList = document.querySelector("#coupon-list");

        if (couponList && !couponList.children.length) {
          addCouponRow();
        }
      }
    });
  }

  /*
   * ==========================================================
   * ADD COUPON
   * ==========================================================
   */

  const addCouponButton = document.querySelector("#add-coupon-btn");

  if (addCouponButton) {
    addCouponButton.addEventListener("click", addCouponRow);
  }

  /*
   * ==========================================================
   * SUBMIT
   * ==========================================================
   */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    const type = formData.get("type");

    /*
     * ======================================================
     * BASIC ASSET DATA
     * ======================================================
     */

    const asset = {
      name: String(formData.get("name") || "").trim(),

      type,

      currency: formData.get("currency") || "UAH",

      quantity: normalizeNumber(formData.get("quantity")),

      purchasePrice: normalizeNumber(formData.get("purchasePrice")),

      purchaseDate: formData.get("purchaseDate"),

      isin: String(formData.get("isin") || "").trim().toUpperCase(),
    };
    const instrumentSelect = document.querySelector("#asset-instrument");
    const isNewInstrument = instrumentSelect?.value === "__new__";
    asset.instrumentName = isNewInstrument ? String(formData.get("newInstrumentName") || "").trim() : instrumentSelect?.value || "";
    asset.instrumentType = isNewInstrument ? String(formData.get("newInstrumentType") || "").trim() : instrumentSelect?.selectedOptions?.[0]?.dataset.instrumentType || "";
    asset.isNewInstrument = isNewInstrument;

    if (type === "s1_reit" && formData.get("currentPrice") !== "") {
      asset.currentPrice = normalizeNumber(formData.get("currentPrice"));
    }

    if (["etf", "stock"].includes(type)) {
      asset.ticker = String(formData.get("ticker") || "").trim().toUpperCase();
      asset.currentPrice = normalizeNumber(formData.get("marketCurrentPrice"));
    }

    /*
     * ======================================================
     * REIT
     * ======================================================
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      asset.paymentMethod = "monthly_dividend";

      asset.dividendPerUnit = normalizeNumber(formData.get("dividendPerUnit"));

      asset.firstDividendDate = formData.get("firstDividendDate");

      if (asset.dividendPerUnit <= 0) {
        showNotice("Enter dividend per unit.");

        return;
      }

      if (!asset.firstDividendDate) {
        showNotice("Enter first dividend date.");

        return;
      }
    }

    /*
     * ======================================================
     * OVDP
     * ======================================================
     */

    if (type === "ovdp") {
      asset.paymentMethod = "coupons";

      asset.maturityDate = formData.get("maturityDate");
      asset.redemptionValue = normalizeNumber(formData.get("redemptionValue")) || 1000;

      asset.coupons = collectCoupons();

      if (!asset.maturityDate) {
        showNotice("Enter maturity date.");

        return;
      }

      if (!asset.coupons.length) {
        showNotice("Add at least one coupon.");

        return;
      }
    }

    /*
     * ======================================================
     * MILTECH
     * ======================================================
     */

    if (type === "inzhur_miltech") {
      asset.paymentMethod = "capitalization";
    }

    if (type === "savings") asset.paymentMethod = "none";
    if (type === "novapay") {
      asset.termMonths = normalizeNumber(formData.get("termMonths"));
      asset.maturityDate = formData.get("novapayMaturityDate");
      asset.maturityAmount = normalizeNumber(formData.get("maturityAmount"));
    }
    if (type === "deposit") {
      asset.annualRate = normalizeNumber(formData.get("annualRate"));
      asset.maturityDate = formData.get("depositMaturityDate");
      asset.earlyWithdrawal = formData.get("earlyWithdrawal") === "on";
    }

    /*
     * ======================================================
     * BASIC VALIDATION
     * ======================================================
     */

    if (
      !asset.name ||
      !asset.type ||
      asset.quantity <= 0 ||
      asset.purchasePrice < 0 ||
      !asset.purchaseDate
    ) {
      showNotice("Please enter valid asset data.");

      return;
    }

    if (!["etf", "stock"].includes(asset.type) && !Number.isInteger(asset.quantity)) {
      showNotice("Quantity must be a whole number.");

      return;
    }

    /*
     * ======================================================
     * SUBMIT BUTTON
     * ======================================================
     */

    const submitButton = form.querySelector('button[type="submit"]');

    let originalText = "Save asset";

    if (submitButton) {
      originalText = submitButton.textContent;

      submitButton.disabled = true;

      submitButton.textContent = state.editingAssetId
        ? "Saving changes..."
        : "Saving...";
    }

    /*
     * ======================================================
     * SAVE
     * ======================================================
     */

    try {
      if (state.editingAssetId) {
        /*
         * EDIT EXISTING ASSET
         */

        if (state.editingAssetIds.length > 1) {
          const merged = await api.mergeAssets(state.editingAssetIds);
          state.editingAssetId = merged.id;
        }
        await api.updateAsset(state.editingAssetId, asset);
      } else {
        /*
         * CREATE NEW ASSET
         */
        const identity = (item) => [
          item.type,
          item.name,
          item.instrumentName || "",
          item.instrumentType || "",
          item.currency || "UAH",
        ].map((value) => String(value).trim().toLocaleLowerCase()).join("::");
        const existingAsset = state.data.assets.find((item) => identity(item) === identity(asset));
        if (existingAsset) {
          await api.buyMoreAsset(existingAsset.id, {
            quantity: asset.quantity,
            purchasePrice: asset.purchasePrice,
            purchaseDate: asset.purchaseDate,
            currency: asset.currency,
            instrumentId: existingAsset.instrumentId,
          });
        } else {
          await api.createAsset(asset);
        }
      }

      /*
       * Reset form/state.
       */

      form.reset();

      clearCoupons();

      state.editingAssetId = null;
      state.editingAssetIds = [];

      setModalMode("add");

      /*
       * Close modal.
       */

      close();

      /*
       * Reload all data.
       */

      await loadData();
    } catch (error) {
      console.error("SAVE ASSET ERROR:", error);

      showNotice(error.message || "Failed to save asset.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent = originalText;
      }
    }
  });

  /*
   * ==========================================================
   * INITIAL STATE
   * ==========================================================
   */

  state.editingAssetId = null;
  state.editingAssetIds = [];

  setModalMode("add");
}

/* ============================================================
   ASSET TYPE SETTINGS
   ============================================================ */

function updateAssetTypeFields() {
  const typeElement = document.querySelector("#asset-type");

  const reitSettings = document.querySelector("#reit-settings");

  const ovdpSettings = document.querySelector("#ovdp-settings");

  const capitalizationSettings = document.querySelector(
    "#capitalization-settings",
  );
  const novapaySettings = document.querySelector("#novapay-settings");
  const depositSettings = document.querySelector("#deposit-settings");

  const dividendInput = document.querySelector("#dividend-per-unit");

  const firstDividendInput = document.querySelector("#first-dividend-date");

  const maturityInput = document.querySelector("#maturity-date");

  const s1CurrentPriceField = document.querySelector("#s1-current-price-field");
  const marketTickerField = document.querySelector("#market-ticker-field");
  const marketCurrentPriceField = document.querySelector("#market-current-price-field");

  const couponInputs = document.querySelectorAll(
    ".coupon-date, .coupon-amount",
  );

  if (!typeElement) {
    return;
  }

  const type = typeElement.value;
  const quantityInput = document.querySelector('#asset-form [name="quantity"]');
  if (quantityInput) {
    quantityInput.step = ["etf", "stock"].includes(type) ? "any" : "1";
  }

  /*
   * Hide all dynamic sections
   */
  [reitSettings, ovdpSettings, capitalizationSettings, novapaySettings, depositSettings]
    .filter(Boolean)
    .forEach((element) => {
      element.classList.remove("visible");
    });

  if (s1CurrentPriceField) {
    s1CurrentPriceField.hidden = true;
  }

  if (marketTickerField) marketTickerField.hidden = !["etf", "stock"].includes(type);
  if (marketCurrentPriceField) marketCurrentPriceField.hidden = !["etf", "stock"].includes(type);

  /*
   * ==========================================================
   * RESET REQUIRED STATE
   * ==========================================================
   */

  if (dividendInput) {
    dividendInput.required = false;
  }

  if (firstDividendInput) {
    firstDividendInput.required = false;
  }

  if (maturityInput) {
    maturityInput.required = false;
  }

  couponInputs.forEach((input) => {
    input.required = false;
  });

  /*
   * ==========================================================
   * REIT
   * ==========================================================
   */

  if (type === "inzhur_reit" || type === "s1_reit") {
    reitSettings?.classList.add("visible");

    if (s1CurrentPriceField) {
      s1CurrentPriceField.hidden = type !== "s1_reit";
    }

    if (dividendInput) {
      dividendInput.required = true;
    }

    if (firstDividendInput) {
      firstDividendInput.required = true;
    }

    /*
     * Coupon fields are NOT required for REIT.
     */
    couponInputs.forEach((input) => {
      input.required = false;
    });

    return;
  }

  /*
   * ==========================================================
   * OVDP
   * ==========================================================
   */

  if (type === "ovdp") {
    ovdpSettings?.classList.add("visible");

    if (maturityInput) {
      maturityInput.required = true;
    }

    /*
     * Coupon fields are required for OVDP.
     */
    couponInputs.forEach((input) => {
      input.required = true;
    });

    return;
  }

  /*
   * ==========================================================
   * MILTECH
   * ==========================================================
   */

  if (type === "inzhur_miltech") {
    capitalizationSettings?.classList.add("visible");

    return;
  }
  if (type === "novapay") novapaySettings?.classList.add("visible");
  if (type === "deposit") depositSettings?.classList.add("visible");
}

/* ============================================================
   COUPONS
   ============================================================ */

function addCouponRow(coupon = {}) {
  const container = document.querySelector("#coupon-list");

  if (!container) {
    return;
  }

  const row = document.createElement("div");

  row.className = "coupon-row";

  const couponDate = coupon.date || "";

  const couponAmount = coupon.amountPerUnit ?? "";

  row.innerHTML = `
        <label>
            <span>
                Coupon date
            </span>

            <input
                type="date"
                class="coupon-date"
                value="${couponDate}"
            />
        </label>

        <label>
            <span>
                Amount per unit
            </span>

            <input
                type="number"
                class="coupon-amount"
                min="0"
                step="0.000001"
                placeholder="85.50"
                value="${couponAmount}"
            />
        </label>

        <button
            type="button"
            class="remove-coupon"
        >
            Remove
        </button>
    `;

  const removeButton = row.querySelector(".remove-coupon");

  if (removeButton) {
    removeButton.addEventListener("click", () => {
      row.remove();

      updateAssetTypeFields();
    });
  }

  container.appendChild(row);

  /*
   * Apply required fields
   * depending on asset type.
   */

  updateAssetTypeFields();
}

function collectCoupons() {
  const rows = document.querySelectorAll(".coupon-row");

  return Array.from(rows)
    .map((row) => ({
      date: row.querySelector(".coupon-date")?.value,

      amountPerUnit: normalizeNumber(
        row.querySelector(".coupon-amount")?.value,
      ),
    }))
    .filter((coupon) => coupon.date && coupon.amountPerUnit > 0);
}

function collectCoupons() {
  const rows = document.querySelectorAll(".coupon-row");

  return Array.from(rows)
    .map((row) => ({
      date: row.querySelector(".coupon-date")?.value,

      amountPerUnit: normalizeNumber(
        row.querySelector(".coupon-amount")?.value,
      ),
    }))
    .filter((coupon) => coupon.date && coupon.amountPerUnit > 0);
}

/* ============================================================
   DEFAULT DATES
   ============================================================ */

function setDefaultDates() {
  const today = getDateString(new Date());

  const purchaseDate = document.querySelector('[name="purchaseDate"]');

  const firstDividendDate = document.querySelector("#first-dividend-date");

  const maturityDate = document.querySelector("#maturity-date");

  if (purchaseDate && !purchaseDate.value) {
    purchaseDate.value = today;
  }

  if (firstDividendDate && !firstDividendDate.value) {
    firstDividendDate.value = today;
  }

  /*
   * Maturity remains empty
   * because it is asset-specific.
   */

  if (maturityDate && maturityDate.value === undefined) {
    maturityDate.value = "";
  }
}

/* ============================================================
   SELL ASSET
   ============================================================ */

function populateSellAssetSelect() {
  const select = document.querySelector("#sell-asset");

  if (!select) {
    return;
  }

  select.innerHTML = `
        <option value="">
            Select asset
        </option>
    `;

  state.data.assets.forEach((asset) => {
    const available = getAvailableQuantity(asset.id);

    if (available <= 0 || asset.type === "novapay" || (asset.type === "deposit" && !asset.earlyWithdrawal)) {
      return;
    }

    const option = document.createElement("option");

    option.value = asset.id;

    option.textContent = holdingOptionLabel(asset);

    select.appendChild(option);
  });
}

function updateSalePreview() {
  const assetSelect = document.querySelector("#sell-asset");

  const quantityInput = document.querySelector("#sell-quantity");

  const priceInput = document.querySelector("#sell-price");

  if (!assetSelect || !quantityInput || !priceInput) {
    return;
  }

  const assetId = assetSelect.value;

  const quantity = normalizeNumber(quantityInput.value);

  const price = normalizeNumber(priceInput.value);

  const asset = state.data.assets.find((item) => item.id === assetId);

  const currency = asset?.currency || "UAH";

  /*
   * Support both old and
   * current HTML selectors.
   */

  const purchasePriceElement = document.querySelector("#sell-purchase-price");

  const costElement =
    document.querySelector("#sell-cost-basis") ||
    document.querySelector("#sale-cost");

  const proceedsElement =
    document.querySelector("#sell-proceeds") ||
    document.querySelector("#sale-proceeds");

  const profitElement =
    document.querySelector("#sell-profit") ||
    document.querySelector("#sale-profit");

  const roiElement =
    document.querySelector("#sell-roi") || document.querySelector("#sale-roi");

  if (!asset) {
    if (purchasePriceElement) {
      purchasePriceElement.textContent = money(0, currency);
    }

    if (costElement) {
      costElement.textContent = money(0, currency);
    }

    if (proceedsElement) {
      proceedsElement.textContent = money(0, currency);
    }

    if (profitElement) {
      profitElement.textContent = money(0, currency);
    }

    if (roiElement) {
      roiElement.textContent = "0%";
    }

    return;
  }

  const purchasePrice = normalizeNumber(asset.purchasePrice);

  const cost = quantity * purchasePrice;

  const proceeds = quantity * price;

  const profit = proceeds - cost;

  const roi = cost > 0 ? (profit / cost) * 100 : 0;

  if (purchasePriceElement) {
    purchasePriceElement.textContent = money(purchasePrice, currency);
  }

  if (costElement) {
    costElement.textContent = money(cost, currency);
  }

  if (proceedsElement) {
    proceedsElement.textContent = money(proceeds, currency);
  }

  if (profitElement) {
    profitElement.textContent = money(profit, currency);
  }

  if (roiElement) {
    roiElement.textContent = `${roi.toFixed(2)}%`;
  }
}

function setupSellModal() {
  const modal = document.querySelector("#sell-modal");

  const form = document.querySelector("#sell-form");

  const openButtons = document.querySelectorAll("#sell-asset-btn, #portfolio-sell-btn");

  /*
   * Do not crash application
   * if selling HTML is missing.
   */

  if (!modal || !form || !openButtons.length) {
    return;
  }

  const close = () => {
    modal.classList.remove("open");
  };

  openButtons.forEach((openButton) => openButton.addEventListener("click", (event) => {
    event.preventDefault();

    populateSellAssetSelect();

    const dateInput = document.querySelector("#sell-date");

    if (dateInput) {
      dateInput.value = getDateString(new Date());
    }

    const quantityInput = document.querySelector("#sell-quantity");

    if (quantityInput) {
      quantityInput.value = "";
    }

    const priceInput = document.querySelector("#sell-price");

    if (priceInput) {
      priceInput.value = "";
    }

    const availableInput = document.querySelector("#sell-available");

    if (availableInput) {
      availableInput.value = "0";
    }

    updateSalePreview();

    modal.classList.add("open");
  }));

  const closeButton = document.querySelector("#close-sell-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  /*
   * IMPORTANT:
   *
   * Your current HTML uses
   * #cancel-sell-modal.
   *
   * The previous app.js used
   * #cancel-sell.
   *
   * Support BOTH.
   */

  const cancelButton =
    document.querySelector("#cancel-sell-modal") ||
    document.querySelector("#cancel-sell");

  if (cancelButton) {
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();

      close();
    });
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  const assetSelect = document.querySelector("#sell-asset");

  if (assetSelect) {
    assetSelect.addEventListener("change", () => {
      const assetId = assetSelect.value;

      const available = getAvailableQuantity(assetId);

      const asset = state.data.assets.find((item) => item.id === assetId);
      const sellQuantityInput = document.querySelector("#sell-quantity");
      if (sellQuantityInput) sellQuantityInput.step = ["etf", "stock"].includes(asset?.type) ? "any" : "1";

      const availableInput = document.querySelector("#sell-available");

      if (availableInput) {
        availableInput.value = asset ? String(available) : "0";
      }

      updateSalePreview();
    });
  }

  const quantityInput = document.querySelector("#sell-quantity");

  if (quantityInput) {
    quantityInput.addEventListener("input", updateSalePreview);
  }

  const priceInput = document.querySelector("#sell-price");

  if (priceInput) {
    priceInput.addEventListener("input", updateSalePreview);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const assetId = document.querySelector("#sell-asset")?.value;

    const quantity = normalizeNumber(
      document.querySelector("#sell-quantity")?.value,
    );

    const sellPrice = normalizeNumber(
      document.querySelector("#sell-price")?.value,
    );

    const sellDate = document.querySelector("#sell-date")?.value;

    const asset = state.data.assets.find((item) => item.id === assetId);

    if (!asset) {
      showNotice("Please select an asset.");

      return;
    }

    const available = getAvailableQuantity(assetId);

    if (quantity <= 0) {
      showNotice("Enter a valid quantity.");

      return;
    }

    if (!Number.isInteger(quantity)) {
      showNotice("Quantity must be a whole number.");

      return;
    }

    if (quantity > available) {
      showNotice(`Available quantity: ${formatQuantity(available)}`);

      return;
    }

    if (sellPrice < 0) {
      showNotice("Enter a valid sale price.");

      return;
    }

    if (!sellDate) {
      showNotice("Select sale date.");

      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;

      submitButton.dataset.originalText = submitButton.textContent;

      submitButton.textContent = "Selling...";
    }

    try {
      await api.createSale({
        assetId,

        quantity,

        sellPrice,

        sellDate,

        currency: asset.currency || "UAH",
      });

      close();

      await loadData();

      showNotice("Sale successfully recorded.");
    } catch (error) {
      console.error("SALE ERROR:", error);

      showNotice(error.message || "Failed to record sale.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent =
          submitButton.dataset.originalText || "Sell asset";
      }
    }
  });
}

/* ============================================================
   PROFIT CALCULATOR
   ============================================================ */

function calculateProfit(from = null, to = null) {
  const result = {
    dividends: 0,
    coupons: 0,
    maturity: 0,
    salesProfit: 0,
    priceGrowth: 0,
    totalProfit: 0,
    invested: 0,
    assets: {},
  };

  /*
   * RECEIVED PAYMENTS ONLY
   */

  (state.data.payments || [])
    .filter(
      (payment) =>
        (payment.status === "received" || payment.status === "paid") &&
        isDateInRange(payment.date, from, to),
    )
    .forEach((payment) => {
      const amount = toUAH(payment.amount, payment.currency);

      const sourceAsset = state.data.assets.find((asset) => asset.id === payment.assetId);
      const assetId = `${sourceAsset?.type || payment.type || "unknown"}::${String(sourceAsset?.name || payment.assetName || "Unknown").trim().toLowerCase()}`;

      if (!result.assets[assetId]) {
        result.assets[assetId] = {
          assetName: payment.assetName || "Unknown",

          currency: "UAH",

          invested: 0,

          dividends: 0,

          coupons: 0,

          maturity: 0,

          salesProfit: 0,

          priceGrowth: 0,
        };
      }

      if (payment.type === "DIVIDEND") {
        result.dividends += amount;

        result.assets[assetId].dividends += amount;
      }

      if (payment.type === "COUPON") {
        result.coupons += amount;

        result.assets[assetId].coupons += amount;
      }

      if (payment.type === "MATURITY") {
        const netMaturity = amount - toUAHPurchaseCost(
          getMaturityCostBasis(payment.assetId),
          payment.currency,
          payment.assetId,
          getAssetPurchaseDate(payment.assetId, payment.date),
        );

        result.maturity += netMaturity;

        result.assets[assetId].maturity += netMaturity;
      }
    });

  /*
   * SALES
   */

  (state.data.sales || [])
    .filter((sale) => sale.type !== "savings" && isDateInRange(sale.sellDate, from, to))
    .forEach((sale) => {
      const profit = toUAH(profitAfterTax(normalizeNumber(sale.profit), sale.type), sale.currency);

      const costBasis = toUAHPurchaseCost(
        sale.costBasis,
        sale.currency,
        sale.assetId,
        getAssetPurchaseDate(sale.assetId, sale.sellDate),
      );

      const sourceAsset = state.data.assets.find((asset) => asset.id === sale.assetId);
      const assetId = `${sourceAsset?.type || sale.type || "unknown"}::${String(sourceAsset?.name || sale.assetName || "Unknown").trim().toLowerCase()}`;

      if (!result.assets[assetId]) {
        result.assets[assetId] = {
          assetName: sale.assetName || "Unknown",

          currency: "UAH",

          invested: 0,

          dividends: 0,

          coupons: 0,

          maturity: 0,

          salesProfit: 0,

          priceGrowth: 0,
        };
      }

      result.salesProfit += profit;

      result.assets[assetId].salesProfit += profit;

      result.assets[assetId].invested += costBasis;

      result.invested += costBasis;
    });

  state.data.assets
    .filter((asset) => getAvailableQuantity(asset.id) > 0 && asset.type !== "savings")
    .forEach((asset) => {
      const assetId = `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
      const invested = getAssetInvestedUah(asset);
      const priceGrowth = toUAH(profitAfterTax(getUnrealizedPriceGrowth(asset), asset.type), asset.currency);

      if (!result.assets[assetId]) {
        result.assets[assetId] = {
          assetName: asset.name,
          currency: "UAH",
          invested: 0,
          dividends: 0,
          coupons: 0,
          maturity: 0,
          salesProfit: 0,
          priceGrowth: 0,
        };
      }

      result.assets[assetId].invested += invested;
      result.assets[assetId].priceGrowth += priceGrowth;
      result.invested += invested;
      result.priceGrowth += priceGrowth;
    });

  result.totalProfit =
    result.dividends +
    result.coupons +
    result.maturity +
    result.salesProfit +
    result.priceGrowth;

  result.roi =
    result.invested > 0 ? (result.totalProfit / result.invested) * 100 : 0;

  return result;
}

/* ============================================================
   ANALYTICS RENDER
   ============================================================ */

function renderProfitCalculator() {
  renderAssetAllocationChart();
  renderPortfolioHistoryChart();

  const from = document.querySelector("#profit-from")?.value || null;

  const to = document.querySelector("#profit-to")?.value || null;

  const result = calculateProfit(from, to);

  /*
   * Support both old and
   * potential new selectors.
   */

  const dividendsElement = document.querySelector("#profit-dividends");

  const couponsElement = document.querySelector("#profit-coupons");

  const maturityElement = document.querySelector("#profit-maturity");

  const salesElement = document.querySelector("#profit-sales");

  const priceGrowthElement = document.querySelector("#profit-price-growth");

  const totalElement = document.querySelector("#profit-total");

  const roiElement = document.querySelector("#profit-roi");

  if (dividendsElement) {
    dividendsElement.textContent = money(result.dividends);
  }

  if (couponsElement) {
    couponsElement.textContent = money(result.coupons);
  }

  if (maturityElement) {
    maturityElement.textContent = money(result.maturity);
  }

  if (salesElement) {
    salesElement.textContent = money(result.salesProfit);
  }

  if (priceGrowthElement) {
    priceGrowthElement.textContent = money(result.priceGrowth);
  }

  if (totalElement) {
    totalElement.textContent = money(result.totalProfit);
  }

  if (roiElement) {
    roiElement.textContent = `${result.roi.toFixed(2)}%`;
  }

  /*
   * Per-asset table
   */

  const renderProfitTable = (tbody, rows) => {
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    class="empty-state"
                >
                    No profit data for selected period.
                </td>
            </tr>
        `;
      return;
    }

    tbody.innerHTML = rows
      .map((asset) => {
      const total =
        asset.dividends +
        asset.coupons +
        asset.maturity +
        asset.salesProfit +
        asset.priceGrowth;

      const roi = asset.invested > 0 ? (total / asset.invested) * 100 : 0;

      return `
                        <tr>

                            <td>
                                <strong>
                                    ${escapeHtml(asset.label)}
                                </strong>
                            </td>

                            <td>
                                ${money(asset.invested, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.dividends, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.coupons, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.maturity, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.salesProfit, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.priceGrowth, asset.currency)}
                            </td>

                            <td>
                                <strong>
                                    ${money(total, asset.currency)}
                                </strong>
                            </td>

                            <td>
                                ${roi.toFixed(2)}%
                            </td>

                        </tr>
                    `;
      })
      .join("");
  };

  const assetRows = Object.entries(result.assets).map(([, asset]) => ({
    ...asset,
    label: asset.assetName,
  }));
  renderProfitTable(document.querySelector("#profit-assets-table"), assetRows);

  const typeRows = Object.entries(result.assets).reduce((groups, [assetId, asset]) => {
    const type = assetId.split("::", 1)[0] || "unknown";
    if (!groups[type]) {
      groups[type] = {
        label: typeLabels[type] || type,
        currency: "UAH",
        invested: 0,
        dividends: 0,
        coupons: 0,
        maturity: 0,
        salesProfit: 0,
        priceGrowth: 0,
      };
    }

    groups[type].invested += asset.invested;
    groups[type].dividends += asset.dividends;
    groups[type].coupons += asset.coupons;
    groups[type].maturity += asset.maturity;
    groups[type].salesProfit += asset.salesProfit;
    groups[type].priceGrowth += asset.priceGrowth;
    return groups;
  }, {});

  renderProfitTable(
    document.querySelector("#profit-types-table"),
    Object.values(typeRows),
  );
}

/* ============================================================
   PROFIT CALCULATOR SETUP
   ============================================================ */

function setupProfitCalculator() {
  const calculateButton = document.querySelector("#calculate-profit");

  const allTimeButton = document.querySelector("#profit-all-time");

  if (calculateButton) {
    calculateButton.addEventListener("click", () => {
      renderProfitCalculator();
    });
  }

  if (allTimeButton) {
    allTimeButton.addEventListener("click", () => {
      const from = document.querySelector("#profit-from");

      const to = document.querySelector("#profit-to");

      if (from) {
        from.value = "";
      }

      if (to) {
        to.value = "";
      }

      renderProfitCalculator();
    });
  }

  /*
   * Automatically recalculate
   * when dates change.
   */

  const from = document.querySelector("#profit-from");

  const to = document.querySelector("#profit-to");
  const historyMode = document.querySelector("#portfolio-history-mode");

  if (from) {
    from.addEventListener("change", renderProfitCalculator);
  }

  if (to) {
    to.addEventListener("change", renderProfitCalculator);
  }

  historyMode?.addEventListener("change", renderPortfolioHistoryChart);
}

/* ============================================================
   PORTFOLIO CONTROLS / REBALANCING
   ============================================================ */

function setupPortfolioSort() {
  const select = document.querySelector("#portfolio-sort");

  if (!select) {
    return;
  }

  select.value = state.portfolioSort;

  select.addEventListener("change", () => {
    state.portfolioSort = select.value;
    renderPortfolio();
  });
}

function setupInzhurSync() {
  const button = document.querySelector("#sync-inzhur-btn");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    const defaultLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Syncing...";

    try {
      const result = await api.syncInzhurAssets();
      await loadData();

      const skipped = result.skipped?.length
        ? ` ${result.skipped.length} asset(s) were skipped — add an ISIN for OVDP or use a supported Inzhur fund type.`
        : "";
      const binanceSynced = result.binanceSynced?.length || 0;
      const binanceErrorHints = {
        BINANCE_NOT_CONFIGURED: "add BINANCE_API_KEY to the root .env file and restart the server",
        EQUITY_NOT_FOUND: "the Binance tokenized-equity symbol or underlying ticker was not found",
        QUOTE_NOT_AVAILABLE: "Binance did not return a current bid/ask quote",
        BINANCE_RATE_LIMITED: "Binance rate-limited the request; try again later",
        BINANCE_TIMEOUT: "the Binance request timed out; try again",
      };
      const binanceSkipped = result.binanceSkipped?.length
        ? ` Binance not updated: ${result.binanceSkipped.map((item) => {
          const holding = item.symbol || item.name || "holding";
          const reason = binanceErrorHints[item.error] || item.message || "Binance API request failed";
          return `${holding} — ${reason}`;
        }).join("; ")}.`
        : "";
      showNotice(`Synchronized ${result.synced.length} Inzhur asset(s) and ${binanceSynced} Binance holding(s).${skipped}${binanceSkipped}`);
    } catch (error) {
      console.error(error);
      showNotice(error.message || "Could not synchronize assets.");
    } finally {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  });
}

function renderRebalanceCalculator() {
  const targets = document.querySelector("#rebalance-targets");

  if (!targets) {
    return;
  }

  const activeAssets = state.data.assets.filter(
    (asset) => getAvailableQuantity(asset.id) > 0 &&
      asset.type !== "savings" &&
      !state.rebalanceExcluded.includes(asset.type === "ovdp" ? "ovdp" : `${asset.type}::${String(asset.name).trim().toLowerCase()}`),
  );

  if (!activeAssets.length && !state.rebalanceDrafts.length) {
    targets.innerHTML = '<p class="rebalance-empty">Add an asset to calculate a rebalance.</p>';
    const total = document.querySelector("#rebalance-total");
    const results = document.querySelector("#rebalance-results");

    if (total) {
      total.textContent = "0%";
    }

    if (results) {
      results.innerHTML = "";
    }

    return;
  }

  const groups = Object.values(
    activeAssets.reduce((result, asset) => {
      const id = asset.type === "ovdp" ? "ovdp" : `${asset.type}::${String(asset.name).trim().toLowerCase()}`;

      if (!result[id]) {
        result[id] = {
          id,
          label: asset.type === "ovdp" ? "OVDP" : asset.name,
          assets: [],
        };
      }

      result[id].assets.push(asset);
      return result;
    }, {}),
  ).concat(state.rebalanceDrafts.map((draft) => ({ ...draft, assets: [] })));

  targets.innerHTML = groups
    .map((group) => `
      <label class="rebalance-field">
        <span title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
        <input type="number" min="0" max="100" step="0.1" value="0" data-rebalance-group="${escapeHtml(group.id)}" aria-label="Target share for ${escapeHtml(group.label)}" />
        <button type="button" class="icon-btn" data-remove-rebalance="${escapeHtml(group.id)}" aria-label="Remove ${escapeHtml(group.label)}">×</button>
      </label>
    `)
    .join("");

  const results = document.querySelector("#rebalance-results");

  if (results) {
    results.innerHTML = "";
  }

  targets.querySelectorAll("[data-rebalance-group]").forEach((input) => {
    input.addEventListener("input", updateRebalanceTotal);
  });

  targets.querySelectorAll("[data-remove-rebalance]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeRebalance;
      if (!id.startsWith("planned-") && !state.rebalanceExcluded.includes(id)) {
        state.rebalanceExcluded.push(id);
      }
      state.rebalanceDrafts = state.rebalanceDrafts.filter((item) => item.id !== id);
      button.closest(".rebalance-field")?.remove();
      updateRebalanceTotal();
    });
  });

  updateRebalanceTotal();
}

function updateRebalanceTotal() {
  const total = [...document.querySelectorAll("[data-rebalance-group]")].reduce(
    (sum, input) => sum + normalizeNumber(input.value),
    0,
  );
  const element = document.querySelector("#rebalance-total");

  if (element) {
    element.textContent = `${total.toFixed(1)}%`;
    element.classList.toggle("invalid", Math.abs(total - 100) > 0.01);
  }
}

function calculateRebalance(event) {
  event.preventDefault();

  const result = document.querySelector("#rebalance-results");
  const inputs = [...document.querySelectorAll("[data-rebalance-group]")];

  if (!result || !inputs.length) {
    return;
  }

  const targets = inputs.map((input) => ({
    groupId: input.dataset.rebalanceGroup,
    percent: normalizeNumber(input.value),
  }));
  const totalPercent = targets.reduce((sum, item) => sum + item.percent, 0);

  if (Math.abs(totalPercent - 100) > 0.01) {
    result.innerHTML = '<p class="rebalance-message">Target shares must total 100%.</p>';
    return;
  }

  const groups = Object.values(
    state.data.assets
      .filter((asset) => getAvailableQuantity(asset.id) > 0 && asset.type !== "savings")
      .reduce((result, asset) => {
        const id = asset.type === "ovdp" ? "ovdp" : `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
        if (!result[id]) {
          result[id] = { id, label: asset.type === "ovdp" ? "OVDP" : asset.name, assets: [] };
        }
        result[id].assets.push(asset);
        return result;
      }, {}),
  ).concat(state.rebalanceDrafts.map((draft) => ({ ...draft, assets: [] })));

  const values = targets.map((target) => {
    const group = groups.find((item) => item.id === target.groupId);
    return {
      ...target,
      group,
      value: (group?.assets || []).reduce(
        (sum, asset) => sum + toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency),
        0,
      ),
    };
  });
  const currentTotal = values.reduce((sum, item) => sum + item.value, 0);
  const totalAfterAddition = Math.max(
    currentTotal,
    ...values.filter((item) => item.percent > 0).map((item) => item.value / (item.percent / 100)),
  );

  const recommendations = values.map((item) => ({
    ...item,
    difference: Math.max(0, totalAfterAddition * (item.percent / 100) - item.value),
  }));
  const totalToInvest = recommendations.reduce((sum, item) => sum + item.difference, 0);

  result.innerHTML = recommendations
    .map((item) => {
      const difference = item.difference;
      const action = difference > 0.005 ? `Buy ${money(difference)}` : "No purchase";
      return `<div class="rebalance-result"><span>${escapeHtml(item.group?.label || "Asset")}</span><strong>${action}</strong></div>`;
    })
    .join("") + `<div class="rebalance-result rebalance-result-total"><span>Total to invest</span><strong>${money(totalToInvest)}</strong></div>`;
}

function setupRebalanceCalculator() {
  const form = document.querySelector("#rebalance-form");
  const modal = document.querySelector("#rebalance-asset-modal");
  const assetForm = document.querySelector("#rebalance-asset-form");
  const closeModal = () => {
    modal?.classList.remove("open");
    assetForm?.reset();
  };

  if (form) {
    form.addEventListener("submit", calculateRebalance);
  }

  document.querySelector("#add-rebalance-asset")?.addEventListener("click", () => {
    modal?.classList.add("open");
    requestAnimationFrame(() => assetForm?.elements.name.focus());
  });

  document.querySelector("#close-rebalance-asset-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-rebalance-asset")?.addEventListener("click", closeModal);
  assetForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(new FormData(assetForm).get("name") || "").trim();
    if (!name) return;
    state.rebalanceDrafts.push({ id: `planned-${Date.now()}`, label: name });
    closeModal();
    renderRebalanceCalculator();
  });
}

function setupThemeToggle() {
  const themeSelect = document.querySelector("#settings-theme-select");
  const fontSelect = document.querySelector("#settings-font-select");
  const biometricControl = document.querySelector("#settings-biometric-control");
  const biometricToggle = document.querySelector("#settings-biometric-toggle");
  const biometricStatus = document.querySelector("#settings-biometric-status");
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  const appLock = isNative ? window.Capacitor?.Plugins?.AppLock : null;
  const themes = ["dark", "light", "monochromatic", "analog"];
  const fonts = ["inter", "montserrat", "roboto", "mono", "oswald", "comic-relief", "dm-sans"];
  const savedTheme = localStorage.getItem("investment-tracker-theme") || "dark";
  const savedFont = localStorage.getItem("investment-tracker-font") || "inter";

  document.documentElement.dataset.theme = themes.includes(savedTheme) ? savedTheme : "dark";
  document.documentElement.dataset.font = fonts.includes(savedFont) ? savedFont : "inter";
  delete document.documentElement.dataset.textSize;
  localStorage.removeItem("investment-tracker-text-size");
  if (themeSelect) themeSelect.value = document.documentElement.dataset.theme;
  if (fontSelect) fontSelect.value = document.documentElement.dataset.font;
  if (appLock) {
    biometricControl.hidden = false;
    appLock.setTheme({ theme: document.documentElement.dataset.theme }).catch(() => {});
    appLock.getSettings().then((settings) => {
      biometricToggle.checked = Boolean(settings.biometricEnabled && settings.biometricAvailable);
      biometricToggle.disabled = !settings.biometricAvailable;
      if (!settings.biometricAvailable) biometricStatus.textContent = "Biometric authentication is not available on this device";
    }).catch(() => {
      biometricToggle.disabled = true;
      biometricStatus.textContent = "Biometric settings are unavailable";
    });
  }

  themeSelect?.addEventListener("change", () => {
    document.documentElement.dataset.theme = themeSelect.value;
    localStorage.setItem("investment-tracker-theme", themeSelect.value);
    appLock?.setTheme({ theme: themeSelect.value }).catch(() => {});
    renderProfitCalculator();
    if (document.querySelector("#wallet-charts")?.classList.contains("active")) renderWalletCharts();
  });
  fontSelect?.addEventListener("change", () => {
    document.documentElement.dataset.font = fontSelect.value;
    localStorage.setItem("investment-tracker-font", fontSelect.value);
  });
  biometricToggle?.addEventListener("change", () => {
    appLock?.setBiometricEnabled({ enabled: biometricToggle.checked }).catch(() => {
      biometricToggle.checked = !biometricToggle.checked;
    });
  });
}

/* ============================================================
   MARKET
   ============================================================ */

let marketPriceChart = null;
let marketRange = "1M";
let marketCustomRange = null;
let marketRequestId = 0;
const marketCurrencies = new Map([
  ["USD", "US Dollar"], ["EUR", "Euro"], ["GBP", "Pound sterling"],
  ["PLN", "Polish zloty"], ["CHF", "Swiss franc"], ["CAD", "Canadian dollar"],
  ["JPY", "Japanese yen"], ["CZK", "Czech koruna"], ["SEK", "Swedish krona"],
]);

const MARKET_RANGE_PARAMS = {
  "1D": { interval: "5min", outputsize: 200 },
  "5D": { interval: "30min", outputsize: 200 },
  "1M": { interval: "1day", outputsize: 31 },
  "6M": { interval: "1day", outputsize: 185 },
  "1Y": { interval: "1day", outputsize: 366 },
  "5Y": { interval: "1week", outputsize: 261 },
  MAX: { interval: "1month", outputsize: 5000 },
};

function marketParamsForRange(range) {
  if (range === "CUSTOM" && marketCustomRange) return { interval: "1day", ...marketCustomRange };
  if (range !== "YTD") return MARKET_RANGE_PARAMS[range] || MARKET_RANGE_PARAMS["1M"];
  const today = new Date();
  return {
    interval: "1day",
    startDate: `${today.getFullYear()}-01-01`,
    endDate: today.toISOString().slice(0, 10),
  };
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function currencyParamsForRange(range) {
  if (range === "CUSTOM" && marketCustomRange) return { ...marketCustomRange };
  const today = new Date().toISOString().slice(0, 10);
  const startDates = {
    "1D": dateDaysAgo(7),
    "5D": dateDaysAgo(10),
    "1M": dateDaysAgo(31),
    "6M": dateDaysAgo(185),
    YTD: `${new Date().getFullYear()}-01-01`,
    "1Y": dateDaysAgo(366),
    "5Y": dateDaysAgo(365 * 5 + 2),
    MAX: "1996-01-01",
  };
  return { startDate: startDates[range] || startDates["1M"], endDate: today };
}

function resolveMarketSymbol(input) {
  const value = String(input || "").trim().toUpperCase();
  if ([".INX", ".DJI", ".IXIC"].includes(value)) return value;
  const holding = (state.data?.assets || []).find((asset) =>
    [asset.name, asset.ticker, asset.symbol].some((candidate) => String(candidate || "").trim().toUpperCase() === value),
  );
  return String(holding?.underlyingSymbol || value).trim().toUpperCase();
}

function populateMarketSymbols() {
  const datalist = document.querySelector("#market-symbols");
  if (!datalist) return;
  const suggestions = new Set([".INX", ".DJI", ".IXIC", "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "SPY", "QQQ", "SMH"]);
  (state.data?.assets || [])
    .filter((asset) => ["stock", "etf"].includes(asset.type))
    .forEach((asset) => suggestions.add(String(asset.underlyingSymbol || asset.ticker || asset.symbol || asset.name || "").trim().toUpperCase()));
  const currencyOptions = [...marketCurrencies].map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} · ${code}/UAH · NBU</option>`);
  currencyOptions.splice(1, 0, '<option value="USEU">USD/EUR · Frankfurter</option>');
  currencyOptions.splice(2, 0, '<option value="EUUS">EUR/USD · Frankfurter</option>');
  const indexNames = { ".INX": "S&P 500 Index", ".DJI": "Dow Jones Industrial Average", ".IXIC": "NASDAQ Composite Index" };
  const tickerOptions = [...suggestions].filter(Boolean).sort().map((symbol) => `<option value="${escapeHtml(symbol)}">${escapeHtml(indexNames[symbol] || "Stock / ETF")}</option>`);
  datalist.innerHTML = [...currencyOptions, ...tickerOptions].join("");
}

function formatMarketPrice(value, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

async function renderMarketChart() {
  const input = document.querySelector("#market-symbol-input");
  const chartState = document.querySelector("#market-chart-state");
  const requestedSymbol = String(input?.value || "USD").trim().toUpperCase();
  const symbol = resolveMarketSymbol(requestedSymbol);
  if (!symbol) return;
  if (input) input.value = requestedSymbol;

  const requestId = ++marketRequestId;
  chartState.textContent = `Loading ${symbol}…`;
  chartState.classList.add("visible");

  try {
    const isCurrency = marketCurrencies.has(symbol);
    const isFrankfurterPair = ["USEU", "EUUS"].includes(symbol);
    const isFredIndex = [".INX", ".DJI", ".IXIC"].includes(requestedSymbol);
    const result = isFredIndex
      ? await api.getIndexHistory({ symbol: requestedSymbol, ...currencyParamsForRange(marketRange) })
      : isFrankfurterPair
      ? await api.getFrankfurterHistory({ ticker: symbol, ...currencyParamsForRange(marketRange) })
      : isCurrency
        ? await api.getCurrencyHistory({ code: symbol, ...currencyParamsForRange(marketRange) })
        : await api.getMarketTimeSeries({ symbol, ...marketParamsForRange(marketRange) });
    if (requestId !== marketRequestId) return;
    let values = result.values || [];
    if ((isCurrency || isFrankfurterPair || isFredIndex) && marketRange === "1D") values = values.slice(-2);
    if ((isCurrency || isFrankfurterPair || isFredIndex) && marketRange === "5D") values = values.slice(-5);
    if (!values.length) throw new Error("No prices are available for this period.");

    const currency = result.meta?.currency || "USD";
    const latest = values.at(-1);
    const first = values[0];
    const previous = values.length > 1 ? values.at(-2) : first;
    const changeBase = marketRange === "1D" ? previous.close : first.close;
    const change = latest.close - changeBase;
    const percent = changeBase ? change / changeBase * 100 : 0;
    const positive = change >= 0;
    const rangeLabel = marketRange === "CUSTOM" && marketCustomRange
      ? `${marketCustomRange.startDate}–${marketCustomRange.endDate}`
      : marketRange;

    document.querySelector("#market-symbol-title").textContent = result.meta?.name
      ? `${result.meta.symbol} · ${result.meta.name}`
      : result.meta?.symbol || symbol;
    document.querySelector("#market-last-price").textContent = formatMarketPrice(latest.close, currency);
    const changeElement = document.querySelector("#market-change");
    changeElement.textContent = `${positive ? "+" : ""}${percent.toFixed(2)}% (${positive ? "+" : ""}${change.toFixed(2)}) · ${rangeLabel}`;
    changeElement.classList.toggle("negative", !positive);
    document.querySelector("#market-last-date").textContent = `${latest.datetime} · ${result.meta?.exchange || "Market"}`;
    document.querySelector("#market-meta").textContent = `${result.meta?.type || "Security"} · ${result.meta?.interval || marketParamsForRange(marketRange).interval} · ${result.provider || "Twelve Data"}${result.cached ? " · cached" : ""}`;

    const styles = getComputedStyle(document.documentElement);
    const lineColor = positive ? styles.getPropertyValue("--positive").trim() : styles.getPropertyValue("--danger").trim();
    const gridColor = styles.getPropertyValue("--border").trim();
    const textColor = styles.getPropertyValue("--muted").trim();
    const context = document.querySelector("#market-price-chart").getContext("2d");
    marketPriceChart?.destroy();
    marketPriceChart = new Chart(context, {
      type: "line",
      data: {
        labels: values.map((point) => point.datetime),
        datasets: [{
          data: values.map((point) => point.close),
          borderColor: lineColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.22,
          fill: true,
          backgroundColor: (chartContext) => {
            const chart = chartContext.chart;
            if (!chart.chartArea) return "transparent";
            const gradient = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
            gradient.addColorStop(0, `${lineColor}55`);
            gradient.addColorStop(1, `${lineColor}05`);
            return gradient;
          },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        animation: { duration: 550 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => formatMarketPrice(item.parsed.y, currency) } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: 7, maxRotation: 0 } },
          y: { position: "right", grid: { color: gridColor }, ticks: { color: textColor, callback: (value) => Number(value).toLocaleString("en-US") } },
        },
      },
    });
    chartState.classList.remove("visible");
  } catch (error) {
    if (requestId !== marketRequestId) return;
    marketPriceChart?.destroy();
    marketPriceChart = null;
    chartState.textContent = error.message || "Could not load market prices.";
    chartState.classList.add("visible");
  }
}

function setupMarket() {
  populateMarketSymbols();
  api.getMarketCurrencies().then((result) => {
    (result.currencies || []).forEach((currency) => marketCurrencies.set(currency.code, currency.name));
    populateMarketSymbols();
  }).catch((error) => console.warn("Could not load NBU currency list:", error.message));
  document.querySelector("#market-symbol-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderMarketChart();
  });
  document.querySelectorAll("[data-market-range]").forEach((button) => {
    button.addEventListener("click", () => {
      marketRange = button.dataset.marketRange;
      document.querySelectorAll("[data-market-range]").forEach((item) => item.classList.toggle("active", item === button));
      renderMarketChart();
    });
  });
  const customForm = document.querySelector("#market-custom-range");
  const fromInput = document.querySelector("#market-date-from");
  const toInput = document.querySelector("#market-date-to");
  if (fromInput && !fromInput.value) fromInput.value = dateDaysAgo(31);
  if (toInput && !toInput.value) toInput.value = new Date().toISOString().slice(0, 10);
  customForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const startDate = fromInput?.value;
    const endDate = toInput?.value;
    if (!startDate || !endDate || startDate > endDate) {
      showNotice("Choose a valid custom date range.");
      return;
    }
    marketCustomRange = { startDate, endDate };
    marketRange = "CUSTOM";
    document.querySelectorAll("[data-market-range]").forEach((item) => item.classList.remove("active"));
    renderMarketChart();
  });
}

/* ============================================================
   NAVIGATION
   ============================================================ */

let macroCharts = [];
let macroLoaded = false;

function macroYearTick(value) {
  const label = this.getLabelForValue(value);
  return String(label || "").slice(0, 4);
}

function macroLineChart(canvasId, series, label, color, suffix = "%") {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas) return;
  const byDate = new Map((series || []).map((point) => [point.date, point.value]));
  const points = [...byDate].sort(([a], [b]) => a.localeCompare(b));
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: points.map(([date]) => date), datasets: [{ label, data: points.map(([, value]) => value), borderColor: color, backgroundColor: `${color}20`, fill: true, tension: 0.28, pointRadius: points.length > 45 ? 0 : 2 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback: macroYearTick } }, y: { ticks: { callback: (value) => `${value}${suffix}` } } }, plugins: { legend: { display: false } } },
  });
  macroCharts.push(chart);
}

function macroMultiChart(canvasId, labels, datasets, rightAxis = false) {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas) return;
  macroCharts.push(new Chart(canvas, {
    type: "line",
    data: { labels, datasets: datasets.map((dataset, index) => ({ ...dataset, tension: 0.25, pointRadius: labels.length > 35 ? 0 : 2, borderWidth: 2, yAxisID: dataset.yAxisID || "y", backgroundColor: `${dataset.borderColor}18` })) },
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback: macroYearTick } }, y: { beginAtZero: false }, ...(rightAxis ? { y1: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: (value) => `${value}%` } } } : {}) }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } } },
  }));
}

function valuesForDates(series, labels) {
  const values = new Map((series || []).map((point) => [point.date, point.value]));
  return labels.map((date) => values.get(date) ?? null);
}

async function renderMacroeconomics() {
  const state = document.querySelector("#macro-state");
  const content = document.querySelector("#macro-content");
  if (!state || !content) return;
  state.hidden = false; state.textContent = "Loading official macroeconomic data…";
  try {
    const data = await api.getMacroeconomics();
    macroCharts.forEach((chart) => chart.destroy()); macroCharts = [];
    const symbols = { USD: "$", EUR: "€", GBP: "£" };
    const currencyOrder = { USD: 0, EUR: 1, GBP: 2 };
    const orderedExchangeRates = [...(data.exchangeRates || [])]
      .sort((a, b) => (currencyOrder[a.code] ?? 99) - (currencyOrder[b.code] ?? 99));
    document.querySelector("#macro-fx-cards").innerHTML = orderedExchangeRates.map((rate) => `<article class="macro-fx-card"><span>${escapeHtml(rate.code)} / UAH</span><strong>${symbols[rate.code] || ""}${currencyFormatter.format(rate.rate)}</strong><small>NBU · ${escapeHtml(rate.date || "latest")}</small></article>`).join("");
    macroLineChart("macro-inflation-annual", data.inflation?.annual, "Annual CPI", "#55d68b");
    macroLineChart("macro-inflation-monthly", data.inflation?.monthly, "Monthly CPI", "#7c8cff");
    macroLineChart("macro-inflation-core", data.inflation?.core, "Core CPI", "#f5c84c");
    macroLineChart("macro-inflation-ppi", data.inflation?.ppi, "PPI", "#ff8a65");
    const gdpDates = [...new Set([...(data.gdp?.nominal || []), ...(data.gdp?.realIndex || [])].map((point) => point.date))].sort();
    macroMultiChart("macro-gdp-chart", gdpDates, [
      { label: "Nominal GDP, UAH million", data: valuesForDates(data.gdp?.nominal, gdpDates), borderColor: "#7c8cff" },
      { label: "Real GDP change, %", data: valuesForDates((data.gdp?.realIndex || []).map((point) => ({ ...point, value: point.value - 100 })), gdpDates), borderColor: "#55d68b", yAxisID: "y1" },
    ], true);
    const errors = Object.entries(data.errors || {});
    const errorNode = document.querySelector("#macro-errors");
    errorNode.hidden = !errors.length;
    errorNode.textContent = errors.length ? `Some sources are temporarily unavailable: ${errors.map(([name]) => name.toUpperCase()).join(", ")}.` : "";
    content.hidden = false; state.hidden = true; macroLoaded = true;
  } catch (error) {
    state.textContent = error.message || "Could not load macroeconomic data.";
  }
}

function setupNavigation() {
  const titleMap = {
    dashboard: "Dashboard",

    portfolio: "Portfolio",

    transactions: "Transactions",

    calendar: "Calendar",

    analytics: "Analytics",

    rebalance: "Rebalance",

    market: "Market",

    macroeconomics: "Macroeconomics",
  };

  document.querySelectorAll("#investments-app .nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section;

      document.querySelectorAll("#investments-app .nav-item").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      document.querySelectorAll(".page-section").forEach((item) => {
        item.classList.toggle("active", item.id === `${section}-section`);
      });

      const pageTitle = document.querySelector("#page-title");

      if (pageTitle) {
        pageTitle.textContent = titleMap[section] || section;
      }

      if (section === "calendar") {
        renderCalendar();
      }

      if (section === "analytics") {
        renderProfitCalculator();
      }

      if (section === "rebalance") {
        renderRebalanceCalculator();
      }

      if (section === "market") {
        populateMarketSymbols();
        renderMarketChart();
      }

      if (section === "macroeconomics" && !macroLoaded) renderMacroeconomics();
    });
  });
}

/* ============================================================
   LOAD DATA
   ============================================================ */

async function loadData() {
  const [data, exchangeData] = await Promise.all([
    api.getData(),
    api.getExchangeRates().catch((error) => {
      console.warn("Using fallback exchange rates:", error.message);
      return null;
    }),
  ]);

  if (exchangeData?.rates) {
    EXCHANGE_RATES.USD = normalizeNumber(exchangeData.rates.USD) || EXCHANGE_RATES.USD;
    EXCHANGE_RATES.EUR = normalizeNumber(exchangeData.rates.EUR) || EXCHANGE_RATES.EUR;
  }

  state.data = {
    assets: Array.isArray(data.assets) ? data.assets : [],

    transactions: Array.isArray(data.transactions) ? data.transactions : [],

    payments: Array.isArray(data.payments) ? data.payments : [],

    calendarNotes: Array.isArray(data.calendarNotes) ? data.calendarNotes : [],

    sales: Array.isArray(data.sales) ? data.sales : [],
    instruments: Array.isArray(data.instruments) ? data.instruments : [],
    wallet: data.wallet && typeof data.wallet === "object"
      ? data.wallet
      : { expenses: [], months: {} },
  };

  await loadPurchaseExchangeRates();

  normalizeWalletCategoryNames();

  console.log("Investment Tracker data loaded:", state.data);

  /*
   * Render everything.
   */

  renderDashboard();
  updateSp500Benchmark();

  renderPortfolio();

  renderRebalanceCalculator();

  renderTransactions();

  renderCalendar();

  renderProfitCalculator();

  renderWallet();

  populateSellAssetSelect();
}

/* ============================================================
   GLOBAL ERROR PROTECTION
   ============================================================ */

function setupGlobalErrorHandling() {
  window.addEventListener("error", (event) => {
    console.error("JavaScript error:", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
  });
}

function disableNumberInputWheelChanges() {
  document.addEventListener("wheel", (event) => {
    const input = event.target.closest?.('input[type="number"]');
    if (input && document.activeElement === input) input.blur();
  }, { capture: true });
}

function applyResponsiveTableLabels() {
  document.querySelectorAll(".table-wrap table:not(.wallet-table):not(.mobile-compact-table), .table-wrapper table:not(.wallet-table):not(.mobile-compact-table)").forEach((table) => {
    table.classList.add("responsive-card-table");
    const headers = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
    table.querySelectorAll("tbody tr, tfoot tr").forEach((row) => {
      let columnIndex = 0;
      [...row.children].forEach((cell) => {
        const colspan = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
        const label = headers[columnIndex] || "Actions";
        cell.dataset.label = label;
        cell.classList.toggle("empty-value", cell.textContent.trim() === "—");
        columnIndex += colspan;
      });
    });
  });
}

function setupResponsiveTables() {
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyResponsiveTableLabels();
    });
  };
  applyResponsiveTableLabels();
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
}

/* ============================================================
   INIT
   ============================================================ */

async function init() {
  console.log("Investment Tracker initializing...");
  setupNoticeModal();
  setupModalBackdropClosing();

  /*
   * Important:
   *
   * Each setup function is isolated.
   * One broken/missing module cannot
   * stop Add Asset from working.
   */

  try {
    setupGlobalErrorHandling();
    disableNumberInputWheelChanges();
    setupGoogleDriveSync();
    setupSettingsModal();
    setupResponsiveTables();
  } catch (error) {
    console.error("Global error setup failed:", error);
  }

  try {
    setupNavigation();
  } catch (error) {
    console.error("Navigation setup failed:", error);
  }

  try {
    setupModal();
  } catch (error) {
    console.error("Asset modal setup failed:", error);
  }

  try {
    setupBuyMoreModal();
  } catch (error) {
    console.error("Buy more modal setup failed:", error);
  }

  try {
    setupCalendarNavigation();
  } catch (error) {
    console.error("Calendar navigation setup failed:", error);
  }

  try {
    setupEventModal();
  } catch (error) {
    console.error("Event modal setup failed:", error);
  }

  try {
    setupNoteModal();
  } catch (error) {
    console.error("Note modal setup failed:", error);
  }

  try {
    setupSellModal();
  } catch (error) {
    console.error("Sell modal setup failed:", error);
  }

  try {
    setupProfitCalculator();
  } catch (error) {
    console.error("Profit calculator setup failed:", error);
  }

  try {
    setupPortfolioSort();
    setupRebalanceCalculator();
    setupMarket();
    setupInzhurSync();
    setupThemeToggle();
    setupAssetTransactionsModal();
    setupDeleteHoldingModal();
  } catch (error) {
    console.error("Portfolio controls setup failed:", error);
  }

  try {
    setupWallet();
    setupLoans();
  } catch (error) {
    console.error("Wallet setup failed:", error);
  }

  /*
   * Load data AFTER all event listeners
   * have been initialized.
   */

  try {
    await loadData();

    console.log("Investment Tracker initialized successfully.");
  } catch (error) {
    console.error("INITIALIZATION ERROR:", error);

    showNotice(
      "Could not connect to the local API. Start the server with npm run dev.",
    );
  }
}

let assetAllocationChart = null;

const stackedDoughnutLegendPlugin = {
  id: "stackedDoughnutLegend",
  afterUpdate(chart, _args, options) {
    const container = document.getElementById(options.containerId);
    if (!container) return;

    const list = document.createElement("ul");
    const items = chart.options.plugins.legend.labels.generateLabels(chart);

    items.forEach((item) => {
      const row = document.createElement("li");
      const button = document.createElement("button");
      const marker = document.createElement("span");
      const label = document.createElement("span");

      button.type = "button";
      button.classList.toggle("is-hidden", item.hidden);
      button.setAttribute("aria-pressed", String(!item.hidden));
      marker.className = "doughnut-legend-marker";
      marker.style.background = item.fillStyle;
      label.textContent = item.text;

      button.append(marker, label);
      button.addEventListener("click", () => {
        chart.toggleDataVisibility(item.index);
        chart.update();
      });
      row.append(button);
      list.append(row);
    });

    container.replaceChildren(list);
  },
};

function renderAssetAllocationChart() {
  const canvas = document.querySelector("#asset-allocation-chart");

  if (!canvas) {
    return;
  }

  const assets = state.data?.assets || [];

  /*
   * ==========================================================
   * ASSET ALLOCATION
   * ==========================================================
   */

  const allocation = {};

  assets.forEach((asset) => {
    if (asset.type === "savings") return;
    const availableQuantity = getAvailableQuantity(asset.id);

    const value = toUAH(availableQuantity * getCurrentPrice(asset), asset.currency);

    const key = asset.type;
    allocation[key] = allocation[key] || { value: 0, label: typeLabels[asset.type] || asset.type };
    allocation[key].value += value;
  });

  const allocationItems = Object.values(allocation).filter((item) => item.value > 0);
  const labels = allocationItems.map((item) => item.label);
  const values = allocationItems.map((item) => item.value);
  const fixedColors = ["#7395DD", "#32A328", "#F587F0", "#E8A33A", "#55C2FF", "#A778E8", "#ED6A5A", "#43C6AC"];
  const allocationColors = allocationItems.map((_, index) => fixedColors[index] || `hsl(${(index * 137.508) % 360} 68% 58%)`);

  /*
   * Remove old chart before
   * creating a new one.
   */

  if (assetAllocationChart) {
    assetAllocationChart.destroy();
  }

  /*
   * Create chart
   */

  assetAllocationChart = new Chart(canvas, {
    type: "doughnut",

    data: {
      labels,

      datasets: [
        {
          data: values,

          backgroundColor: allocationColors,

          borderWidth: 1,

          borderColor: "#F9DDDE",

          hoverOffset: 10,
        },
      ],
    },

    plugins: [stackedDoughnutLegendPlugin],

    options: {
      responsive: true,

      maintainAspectRatio: false,

      cutout: "45%",

      plugins: {
        legend: {
          display: false,

          labels: {
            generateLabels: function (chart) {
              const data = chart.data.datasets[0].data;

              const total = data.reduce(
                (sum, value) => sum + Number(value || 0),
                0,
              );

              return chart.data.labels.map((label, index) => {
                const value = Number(data[index] || 0);

                const percentage = total > 0 ? (value / total) * 100 : 0;

                return {
                  text: `${label} (${percentage.toFixed(1)}%)`,

                  fillStyle: chart.data.datasets[0].backgroundColor[index],

                  strokeStyle: chart.data.datasets[0].borderColor,

                  lineWidth: chart.data.datasets[0].borderWidth,

                  hidden: !chart.getDataVisibility(index),

                  index,
                  fontColor: getComputedStyle(document.documentElement)
                    .getPropertyValue("--chart-legend-text")
                    .trim(),
                };
              });
            },
          },
        },

        stackedDoughnutLegend: { containerId: "asset-allocation-legend" },

        tooltip: {
          callbacks: {
            label: function (context) {
              const value = context.raw || 0;

              const total = context.dataset.data.reduce(
                (sum, item) => sum + item,
                0,
              );

              const percentage = total > 0 ? (value / total) * 100 : 0;

              return (
                `${context.label}: ` +
                `${money(value)} ` +
                `(${percentage.toFixed(1)}%)`
              );
            },
          },
        },
      },
    },
  });
}

let portfolioHistoryChart = null;

function renderPortfolioHistoryChart() {
  const canvas = document.querySelector("#portfolio-history-chart");

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  const mode = document.querySelector("#portfolio-history-mode")?.value || "value";
  const description = document.querySelector("#portfolio-history-description");
  const assetsById = new Map((state.data.assets || []).map((asset) => [asset.id, asset]));
  const movements = (state.data.transactions || [])
    .filter((transaction) => {
      const asset = assetsById.get(transaction.assetId);
      return asset?.type !== "savings" && transaction.date && ["BUY", "SELL"].includes(transaction.type);
    })
    .map((transaction) => ({
      date: transaction.date,
      assetId: transaction.assetId,
      quantity: (transaction.type === "BUY" ? 1 : -1) * normalizeNumber(transaction.quantity),
      amount:
        transaction.type === "BUY"
          ? toUAHAtDate(transaction.amount, transaction.currency, transaction.date)
          : -toUAHPurchaseCost(
            transaction.costBasis || transaction.amount,
            transaction.currency,
            transaction.assetId,
            getAssetPurchaseDate(transaction.assetId, transaction.date),
          ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (portfolioHistoryChart) {
    portfolioHistoryChart.destroy();
  }

  const earnedEvents = [
    ...(state.data.payments || [])
      .filter((payment) => payment.status === "received" || payment.status === "paid")
      .map((payment) => {
        const date = payment.receivedDate || String(payment.receivedAt || "").slice(0, 10) || payment.date;
        const maturityBasis = payment.type === "MATURITY" ? getMaturityCostBasis(payment.assetId) : 0;
        return { date, amount: toUAH(normalizeNumber(payment.amount) - maturityBasis, payment.currency) };
      }),
    ...(state.data.sales || [])
      .filter((sale) => sale.type !== "savings" && sale.sellDate)
      .map((sale) => ({
        date: sale.sellDate,
        amount: toUAH(profitAfterTax(normalizeNumber(sale.profit), sale.type), sale.currency),
      })),
  ].filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(String(event.date))).sort((a, b) => a.date.localeCompare(b.date));

  const datedEvents = [...movements, ...earnedEvents];

  if (!datedEvents.length) {
    portfolioHistoryChart = new Chart(canvas, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: { responsive: true, maintainAspectRatio: false },
    });
    return;
  }

  const firstEventDate = datedEvents.map((event) => event.date).sort()[0];
  const firstDate = new Date(`${firstEventDate}T00:00:00`);
  const lastDate = new Date();
  const labels = [];
  const investedValues = [];
  const monthlyInvestedValues = [];
  const portfolioValues = [];
  const earnedValues = [];
  const quantities = new Map();
  let runningInvested = 0;
  let movementIndex = 0;
  let earnedIndex = 0;
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  const lastMonth = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);

  while (cursor <= lastMonth) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const monthEndString = getDateString(monthEnd);

    let investedThisMonth = 0;
    while (movementIndex < movements.length && movements[movementIndex].date <= monthEndString) {
      const movement = movements[movementIndex];
      runningInvested += movement.amount;
      investedThisMonth += movement.amount;
      quantities.set(movement.assetId, normalizeNumber(quantities.get(movement.assetId)) + movement.quantity);
      movementIndex += 1;
    }

    let earnedThisMonth = 0;
    const monthKey = getDateString(cursor).slice(0, 7);
    while (earnedIndex < earnedEvents.length && earnedEvents[earnedIndex].date.slice(0, 7) <= monthKey) {
      if (earnedEvents[earnedIndex].date.slice(0, 7) === monthKey) earnedThisMonth += earnedEvents[earnedIndex].amount;
      earnedIndex += 1;
    }

    const portfolioValue = [...quantities.entries()].reduce((sum, [assetId, quantity]) => {
      const asset = assetsById.get(assetId);
      if (!asset || quantity <= 0) return sum;
      return sum + toUAH(quantity * getCurrentPrice(asset), asset.currency);
    }, 0);

    labels.push(cursor.toLocaleDateString("uk-UA", { month: "short", year: "numeric" }));
    investedValues.push(Math.max(0, runningInvested));
    monthlyInvestedValues.push(investedThisMonth);
    portfolioValues.push(Math.max(0, portfolioValue));
    earnedValues.push(earnedThisMonth);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const chartModes = {
    value: {
      label: "Portfolio value",
      description: "Portfolio value by month",
      values: portfolioValues,
      type: "line",
      color: "#7c8cff",
      background: "rgba(124, 140, 255, 0.18)",
    },
    profit: {
      label: "Value/invested difference",
      description: "Difference between portfolio value and invested capital",
      values: portfolioValues.map((value, index) => value - investedValues[index]),
      type: "line",
      color: "#49c58b",
      background: "rgba(73, 197, 139, 0.18)",
    },
    earned: {
      label: "Money earned",
      description: "Received income and realized profit by month",
      values: earnedValues,
      type: "bar",
      color: "#e8a33a",
      background: "rgba(232, 163, 58, 0.65)",
    },
    invested: {
      label: "Invested by month",
      description: "Net invested capital by month",
      values: monthlyInvestedValues,
      type: "bar",
      color: "#7c8cff",
      background: "rgba(124, 140, 255, 0.68)",
    },
  };
  const selected = chartModes[mode] || chartModes.value;
  if (description) description.textContent = selected.description;

  const chartText = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();

  portfolioHistoryChart = new Chart(canvas, {
    type: selected.type,
    data: {
      labels,
      datasets: [{
        label: selected.label,
        data: selected.values,
        borderColor: selected.color,
        backgroundColor: selected.background,
        fill: selected.type === "line",
        tension: 0.28,
        pointRadius: selected.type === "line" ? 3 : 0,
        borderRadius: selected.type === "bar" ? 5 : 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (context) => `${selected.label}: ${money(context.raw)}` } },
      },
      scales: {
        x: { ticks: { color: chartText }, grid: { color: gridColor } },
        y: { ticks: { color: chartText, callback: (value) => money(value) }, grid: { color: gridColor } },
      },
    },
  });
}

function openBuyMoreModal(assetId) {
  const asset = state.data?.assets?.find((item) => item.id === assetId);

  if (!asset) {
    showNotice("Asset not found.");

    return;
  }

  const modal = document.querySelector("#buy-more-modal");

  const form = document.querySelector("#buy-more-form");

  if (!modal || !form) {
    console.warn("Buy more modal or form was not found.");

    return;
  }

  state.buyingAssetId = assetId;
  const buyQuantityInput = form.querySelector('[name="quantity"]');
  if (buyQuantityInput) buyQuantityInput.step = ["etf", "stock"].includes(asset.type) ? "any" : "1";

  const assetNameInput = document.querySelector("#buy-more-asset-name");

  if (assetNameInput) {
    assetNameInput.value = `${asset.name} (${asset.currency || "UAH"})`;
  }
  const currencyInput = document.querySelector("#buy-currency");
  if (currencyInput) currencyInput.value = asset.currency || "UAH";

  /*
   * Clear previous values
   */

  form.reset();

  /*
   * Restore asset name after reset
   */

  if (assetNameInput) {
    assetNameInput.value = `${asset.name} (${asset.currency || "UAH"})`;
  }
  if (currencyInput) currencyInput.value = asset.currency || "UAH";

  /*
   * Default date = today
   */

  const dateInput = document.querySelector("#buy-more-date");

  if (dateInput) {
    dateInput.value = new Date().toISOString().split("T")[0];
  }

  modal.classList.add("open");
}

function setupBuyMoreModal() {
  const modal = document.querySelector("#buy-more-modal");

  const form = document.querySelector("#buy-more-form");

  if (!modal || !form) {
    console.warn("Buy more modal or form was not found.");

    return;
  }

  form.noValidate = true;

  /*
   * ==========================================================
   * CLOSE MODAL
   * ==========================================================
   */

  const close = () => {
    modal.classList.remove("open");

    state.buyingAssetId = null;

    form.reset();
  };

  /*
   * Close button
   */

  const closeButton = document.querySelector("#close-buy-more-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  /*
   * Cancel button
   */

  const cancelButton = document.querySelector("#cancel-buy-more");

  if (cancelButton) {
    cancelButton.addEventListener("click", close);
  }

  /*
   * Click outside
   */

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  /*
   * ==========================================================
   * SUBMIT
   * ==========================================================
   */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const assetId = state.buyingAssetId;

    if (!assetId) {
      showNotice("Asset was not selected.");

      return;
    }

    const formData = new FormData(form);

    const purchase = {
      quantity: normalizeNumber(formData.get("quantity")),

      purchasePrice: normalizeNumber(formData.get("purchasePrice")),

      purchaseDate: formData.get("purchaseDate"),
    };

    /*
     * ======================================================
     * VALIDATION
     * ======================================================
     */

    if (purchase.quantity <= 0) {
      showNotice("Enter a valid quantity.");

      return;
    }

    const purchasedAsset = state.data.assets.find((asset) => asset.id === assetId);
    if (!["etf", "stock"].includes(purchasedAsset?.type) && !Number.isInteger(purchase.quantity)) {
      showNotice("Quantity must be a whole number.");

      return;
    }

    if (purchase.purchasePrice < 0) {
      showNotice("Enter a valid purchase price.");

      return;
    }

    if (!purchase.purchaseDate) {
      showNotice("Enter a purchase date.");

      return;
    }

    /*
     * ======================================================
     * SUBMIT BUTTON
     * ======================================================
     */

    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;

      submitButton.dataset.originalText = submitButton.textContent;

      submitButton.textContent = "Saving...";
    }

    try {
      /*
       * ==================================================
       * BUY MORE ASSET
       * ==================================================
       */

      await api.buyMoreAsset(assetId, purchase);

      /*
       * Close modal
       */

      close();

      /*
       * Reload application data
       */

      await loadData();
    } catch (error) {
      console.error("BUY MORE ASSET ERROR:", error);

      showNotice(error.message || "Failed to buy more asset.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent =
          submitButton.dataset.originalText || "Докупити";
      }
    }
  });
}

/* ============================================================
   START
   ============================================================ */

const WALLET_CATEGORIES = [
  "Salary", "Tithe", "Utilities", "Savings",
  "Groceries + household", "Fuel", "Transport", "Subscriptions",
  "Other", "Entertainment", "Gifts", "Health", "Children",
];

const walletCurrencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function walletMoney(value) {
  return `${walletCurrencyFormatter.format(normalizeNumber(value))} ₴`;
}

function formatWalletDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US");
}

function walletMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeWalletCategoryNames() {
  const replacements = {
    "Groceries + household goods": "Groceries + household",
    "Other expenses": "Other",
  };
  const wallet = state.data.wallet;
  (wallet.expenses || []).forEach((expense) => { expense.category = replacements[expense.category] || expense.category; });
  Object.values(wallet.months || {}).forEach((month) => {
    Object.entries(replacements).forEach(([oldName, newName]) => {
      if (month.plans?.[oldName] != null) {
        month.plans[newName] = month.plans[oldName];
        delete month.plans[oldName];
      }
    });
    month.customCategories = (month.customCategories || []).map((name) => replacements[name] || name);
  });
}

function walletMonth(key) {
  const wallet = state.data.wallet;
  wallet.expenses ||= [];
  wallet.months ||= {};
  wallet.months[key] ||= { plans: {}, customCategories: [], notes: [] };
  wallet.months[key].plans ||= {};
  wallet.months[key].customCategories ||= [];
  wallet.months[key].notes ||= [];
  return wallet.months[key];
}

function walletCategories(key) {
  return [...new Set([...WALLET_CATEGORIES, ...walletMonth(key).customCategories])];
}

function walletExpenses(key) {
  return (state.data.wallet.expenses || []).filter((expense) => String(expense.date).slice(0, 7) === key);
}

function walletCategoryTotal(key, category) {
  return walletExpenses(key)
    .filter((expense) => expense.category === category)
    .reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0);
}

function cleanupUnusedWalletCategories() {
  Object.entries(state.data.wallet.months || {}).forEach(([key, month]) => {
    month.customCategories = (month.customCategories || []).filter((category) => {
      const stillUsed = walletExpenses(key).some((expense) => expense.category === category);
      if (!stillUsed && month.plans) delete month.plans[category];
      return stillUsed;
    });
  });
}

function renderWalletCurrent() {
  const body = document.querySelector("#wallet-current-body");
  if (!body) return;
  const monthInput = document.querySelector("#wallet-current-month");
  if (monthInput) monthInput.value ||= walletMonthKey();
  const key = monthInput?.value || walletMonthKey();
  const month = walletMonth(key);
  const categories = walletCategories(key);
  const expenseCategories = categories.filter((category) => category !== "Salary");
  const totalPlan = expenseCategories.reduce((sum, category) => sum + normalizeNumber(month.plans[category]), 0);
  const totalActual = expenseCategories.reduce((sum, category) => sum + walletCategoryTotal(key, category), 0);
  const spendingActual = totalActual - walletCategoryTotal(key, "Savings") - walletCategoryTotal(key, "Tithe");
  const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  document.querySelector("#wallet-month-title").innerHTML = `Budget<span>${escapeHtml(monthName)}</span>`;

  const row = (category) => {
    const plan = normalizeNumber(month.plans[category]);
    const actual = walletCategoryTotal(key, category);
    const percent = totalPlan > 0 ? plan / totalPlan * 100 : 0;
    const actualPercent = totalActual > 0 ? actual / totalActual * 100 : 0;
    const balance = plan - actual;
    return `<tr><td>${escapeHtml(category)}</td><td><input type="number" min="0" step="0.01" enterkeyhint="done" value="${plan || ""}" data-wallet-plan="${escapeHtml(category)}" aria-label="Plan: ${escapeHtml(category)}"></td><td>${percent.toFixed(1)}%</td><td>${walletMoney(actual)}</td><td class="wallet-balance ${balance < 0 ? "negative-balance" : balance > 0 ? "positive-balance" : ""}">${walletMoney(balance)}</td><td>${actualPercent.toFixed(1)}%</td><td>${month.customCategories.includes(category) && actual === 0 ? `<button class="icon-btn" data-remove-wallet-category="${escapeHtml(category)}">×</button>` : ""}</td></tr>`;
  };

  const remainder = totalPlan - totalActual;
  body.innerHTML = `<tr class="wallet-summary-row"><td>Budget<br>${escapeHtml(monthName)}</td><td>${walletMoney(totalPlan)}</td><td>100%</td><td>${walletMoney(totalActual)}</td><td class="wallet-balance ${remainder < 0 ? "negative-balance" : remainder > 0 ? "positive-balance" : ""}">${walletMoney(remainder)}</td><td>${totalPlan > 0 ? (totalActual / totalPlan * 100).toFixed(1) : "0.0"}%</td><td></td></tr>`
    + expenseCategories.map(row).join("")
    + `<tr class="wallet-summary-row"><td>Total</td><td>${walletMoney(totalPlan)}</td><td>100%</td><td>${walletMoney(totalActual)}</td><td class="wallet-balance ${remainder < 0 ? "negative-balance" : remainder > 0 ? "positive-balance" : ""}">${walletMoney(remainder)}</td><td>${totalPlan > 0 ? (totalActual / totalPlan * 100).toFixed(1) : "0.0"}%</td><td></td></tr>`
    + `<tr class="wallet-summary-row"><td>Expenses for ${escapeHtml(monthName)}</td><td colspan="5">${walletMoney(spendingActual)}</td><td></td></tr>`;

  renderBudgetProgress(totalActual, totalPlan);

  body.querySelectorAll("[data-wallet-plan]").forEach((input) => input.addEventListener("change", async () => {
    month.plans[input.dataset.walletPlan] = normalizeNumber(input.value);
    await api.saveWallet(state.data.wallet);
    renderWalletCurrent();
  }));
  body.querySelectorAll("[data-wallet-plan]").forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  }));
  body.querySelectorAll("[data-remove-wallet-category]").forEach((button) => button.addEventListener("click", async () => {
    month.customCategories = month.customCategories.filter((name) => name !== button.dataset.removeWalletCategory);
    delete month.plans[button.dataset.removeWalletCategory];
    await api.saveWallet(state.data.wallet);
    renderWallet();
  }));
}

function renderBudgetProgress(spent, budget) {
  const card = document.querySelector("#budget-progress-card");
  if (!card) return;
  const percentage = budget > 0 ? spent / budget * 100 : 0;
  const fillPercentage = Math.min(Math.max(percentage, 0), 100);
  const remaining = budget - spent;
  document.querySelector("#budget-progress-values").textContent = `${walletMoney(spent)} / ${walletMoney(budget)}`;
  document.querySelector("#budget-progress-percent").textContent = `${percentage.toFixed(percentage >= 100 ? 0 : 1).replace(".0", "")}%`;
  document.querySelector("#budget-progress-remaining").textContent = `${walletMoney(remaining)} remaining`;
  const level = percentage > 100 ? "over" : percentage >= 80 ? "high" : percentage >= 60 ? "medium" : "low";
  card.dataset.level = level;
  const progress = card.querySelector(".wave-progress");
  const fill = document.querySelector("#budget-progress-fill");
  progress.setAttribute("aria-valuenow", String(Math.round(percentage)));
  progress.setAttribute("aria-valuetext", `${walletMoney(spent)} of ${walletMoney(budget)} spent; ${walletMoney(remaining)} remaining`);
  fill.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${fillPercentage}%`; }));
}

function renderWalletArchive() {
  const input = document.querySelector("#wallet-archive-month");
  const table = document.querySelector("#wallet-archive-table");
  if (!input || !table) return;
  input.value ||= walletMonthKey();
  const key = input.value;
  const categories = walletCategories(key);
  const expenses = walletExpenses(key);
  const days = [...new Set(expenses.map((expense) => expense.date))].sort();
  const categoryTotals = categories.map((category) => walletCategoryTotal(key, category));
  table.innerHTML = `<thead><tr><th>Date</th>${categories.map((category) => `<th>${escapeHtml(category)}</th>`).join("")}<th>Total</th></tr></thead><tbody>`
    + (days.length ? days.map((date) => {
      const values = categories.map((category) => expenses.filter((item) => item.date === date && item.category === category).reduce((sum, item) => sum + normalizeNumber(item.amount), 0));
      const expenseTotal = values.reduce((sum, value, index) => sum + (categories[index] === "Salary" ? 0 : value), 0);
      return `<tr><td>${formatWalletDate(date)}</td>${values.map((value) => `<td>${value ? walletMoney(value) : "—"}</td>`).join("")}<td>${walletMoney(expenseTotal)}</td></tr>`;
    }).join("") : `<tr><td colspan="${categories.length + 2}" class="empty-state">No expenses for this month.</td></tr>`)
    + `</tbody><tfoot><tr class="wallet-summary-row"><th>Monthly total</th>${categoryTotals.map((value) => `<th>${walletMoney(value)}</th>`).join("")}<th>${walletMoney(categoryTotals.reduce((sum, value, index) => sum + (categories[index] === "Salary" ? 0 : value), 0))}</th></tr></tfoot>`;
}

function renderWalletExpenseList() {
  const body = document.querySelector("#wallet-expense-list");
  if (!body) return;
  const monthInput = document.querySelector("#wallet-expenses-month");
  if (monthInput) monthInput.value ||= walletMonthKey();
  const expenses = walletExpenses(monthInput?.value || walletMonthKey()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  body.innerHTML = expenses.length ? expenses.map((expense) => `<tr><td>${formatWalletDate(expense.date)}</td><td>${escapeHtml(expense.category)}</td><td>${walletMoney(expense.amount)}</td><td>${escapeHtml(expense.note || "—")}</td><td><button class="secondary-btn" data-edit-expense="${escapeHtml(expense.id)}">Edit</button> <button class="icon-btn" data-delete-expense="${escapeHtml(expense.id)}" aria-label="Delete">×</button></td></tr>`).join("") : '<tr><td colspan="5" class="empty-state">No recorded expenses this month.</td></tr>';
  body.querySelectorAll("[data-edit-expense]").forEach((button) => button.addEventListener("click", () => openExpenseModal(button.dataset.editExpense)));
  body.querySelectorAll("[data-delete-expense]").forEach((button) => button.addEventListener("click", async () => {
    if (!(await showConfirm("Delete this expense?"))) return;
    state.data.wallet.expenses = state.data.wallet.expenses.filter((expense) => expense.id !== button.dataset.deleteExpense);
    cleanupUnusedWalletCategories();
    await api.saveWallet(state.data.wallet);
    renderWallet();
  }));
}

function renderWalletNotes() {
  const list = document.querySelector("#wallet-notes-list");
  const description = document.querySelector("#wallet-notes-description");
  if (!list) return;
  const key = document.querySelector("#wallet-current-month")?.value || walletMonthKey();
  const month = walletMonth(key);
  const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (description) description.textContent = `Notes for ${monthName}`;
  list.innerHTML = month.notes.length
    ? month.notes.map((note) => `<div class="wallet-note"><span>${escapeHtml(note.text)}</span><button type="button" class="icon-btn" data-delete-wallet-note="${escapeHtml(note.id)}" aria-label="Delete note">×</button></div>`).join("")
    : "";
  list.querySelectorAll("[data-delete-wallet-note]").forEach((button) => button.addEventListener("click", async () => {
    month.notes = month.notes.filter((note) => note.id !== button.dataset.deleteWalletNote);
    await api.saveWallet(state.data.wallet);
    renderWalletNotes();
  }));
}

let walletCategoryChart = null;
let walletDailyChart = null;
let walletMonthlyChart = null;
let walletPeriodChart = null;

function walletMonthAxisTicks() {
  return {
    autoSkip: true,
    maxTicksLimit: window.innerWidth <= 700 ? 4 : 8,
    minRotation: 0,
    maxRotation: 0,
    callback(value) {
      const label = String(this.getLabelForValue(value) || "");
      const month = label.slice(0, 7);
      return /^\d{4}-\d{2}$/.test(month) ? month : label;
    },
  };
}

function walletExpenseDateBounds() {
  const dates = (state.data.wallet.expenses || [])
    .filter((expense) => expense.category !== "Salary" && /^\d{4}-\d{2}-\d{2}$/.test(String(expense.date)))
    .map((expense) => expense.date)
    .sort();
  const today = getDateString();
  return { first: dates[0] || today, last: dates.at(-1) || today, today };
}

function shiftWalletDate(dateString, { days = 0, months = 0, years = 0 }) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function applyWalletPeriodPreset() {
  const preset = document.querySelector("#wallet-period-preset")?.value || "all";
  const fromInput = document.querySelector("#wallet-period-from");
  const toInput = document.querySelector("#wallet-period-to");
  if (!fromInput || !toInput || preset === "custom") return;
  const { first, last, today } = walletExpenseDateBounds();
  const ranges = {
    all: [first, last],
    "7d": [shiftWalletDate(today, { days: -6 }), today],
    "30d": [shiftWalletDate(today, { days: -29 }), today],
    "3m": [shiftWalletDate(today, { months: -3 }), today],
    ytd: [`${today.slice(0, 4)}-01-01`, today],
    "1y": [shiftWalletDate(today, { years: -1 }), today],
  };
  [fromInput.value, toInput.value] = ranges[preset] || ranges.all;
}

function renderWalletPeriodChart() {
  const fromInput = document.querySelector("#wallet-period-from");
  const toInput = document.querySelector("#wallet-period-to");
  const totalElement = document.querySelector("#wallet-period-total");
  const canvas = document.querySelector("#wallet-period-chart");
  if (!fromInput || !toInput || !totalElement || !canvas) return;
  if (document.querySelector("#wallet-period-preset")?.value !== "custom" || !fromInput.value || !toInput.value) applyWalletPeriodPreset();

  const from = fromInput.value;
  const to = toInput.value;
  const expenses = (state.data.wallet.expenses || []).filter((expense) =>
    expense.category !== "Salary" && expense.date >= from && expense.date <= to,
  );
  const total = expenses.reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0);
  totalElement.textContent = walletMoney(total);

  const dailyTotals = expenses.reduce((result, expense) => {
    result[expense.date] = (result[expense.date] || 0) + normalizeNumber(expense.amount);
    return result;
  }, {});
  const labels = [];
  const cumulativeValues = [];
  if (from && to && from <= to) {
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    let cumulative = 0;
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      cumulative += dailyTotals[date] || 0;
      labels.push(date);
      cumulativeValues.push(cumulative);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  walletPeriodChart?.destroy();
  walletPeriodChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ label: "Cumulative expenses", data: cumulativeValues, borderColor: "#49c58b", backgroundColor: "rgba(73,197,139,.14)", fill: true, tension: .22, pointRadius: labels.length > 60 ? 0 : 2, pointHoverRadius: 4, borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Cumulative expenses during the selected period" },
        tooltip: { callbacks: { label: (item) => walletMoney(item.parsed.y) } },
      },
      scales: {
        x: { ticks: walletMonthAxisTicks() },
        y: { beginAtZero: true, ticks: { callback: (value) => walletMoney(value) } },
      },
    },
  });
}

function renderWalletCategoryChart(key) {
  const expenses = walletExpenses(key).filter((expense) => expense.category !== "Salary");
  const categories = [...new Set(expenses.map((expense) => expense.category))];
  const categoryValues = categories.map((category) => expenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0));
  const chartColors = ["#7395DD", "#F587F0", "#32A328", "#e9a23b", "#7c8cff", "#2bb3a3", "#c76dd8", "#FDBDBA"];
  walletCategoryChart?.destroy();
  walletCategoryChart = new Chart(document.querySelector("#wallet-category-chart"), {
    type: "doughnut",
    data: { labels: categories, datasets: [{ data: categoryValues, backgroundColor: chartColors }] },
    plugins: [stackedDoughnutLegendPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      circumference: 180,
      rotation: 270,
      cutout: "55%",
      plugins: {
        title: { display: true, text: "Spending by category" },
        legend: {
          display: false,
        },
        stackedDoughnutLegend: { containerId: "wallet-category-legend" },
      },
    },
  });
}

function renderWalletDailyChart(key) {
  const expenses = walletExpenses(key).filter((expense) => expense.category !== "Salary");
  const dayCount = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  const dailyValues = days.map((day) => expenses.filter((expense) => Number(expense.date.slice(8, 10)) === day).reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0));
  walletDailyChart?.destroy();
  walletDailyChart = new Chart(document.querySelector("#wallet-daily-chart"), { type: "line", data: { labels: days, datasets: [{ label: "Daily expenses", data: dailyValues, borderColor: "#7395DD", backgroundColor: "rgba(115,149,221,.18)", fill: true, tension: .25 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: false } }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: window.innerWidth <= 700 ? 6 : 10, maxRotation: 0 } } } } });
}

function renderWalletMonthlyChart() {
  const allExpenses = (state.data.wallet.expenses || []).filter((expense) => expense.category !== "Salary");
  const monthlyCategorySelect = document.querySelector("#wallet-monthly-category");
  const previousSelection = monthlyCategorySelect?.value || "__total__";
  const allCategories = [...new Set(allExpenses.map((expense) => expense.category))].sort();
  if (monthlyCategorySelect) {
    monthlyCategorySelect.innerHTML = '<option value="__total__">Total</option>' + allCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    monthlyCategorySelect.value = allCategories.includes(previousSelection) || previousSelection === "__total__" ? previousSelection : "__total__";
  }
  const selectedCategory = monthlyCategorySelect?.value || "__total__";
  const monthTotals = {};
  allExpenses.forEach((expense) => {
    const month = String(expense.date).slice(0, 7);
    if (!monthTotals[month]) monthTotals[month] = 0;
    if (selectedCategory === "__total__" || expense.category === selectedCategory) {
      monthTotals[month] += normalizeNumber(expense.amount);
    }
  });
  const months = Object.keys(monthTotals).sort();
  const seriesLabel = selectedCategory === "__total__" ? "Total expenses" : selectedCategory;
  walletMonthlyChart?.destroy();
  walletMonthlyChart = new Chart(document.querySelector("#wallet-monthly-chart"), { type: "line", data: { labels: months, datasets: [{ label: seriesLabel, data: months.map((month) => monthTotals[month]), borderColor: "#7c8cff", backgroundColor: "rgba(124,140,255,.18)", fill: true, tension: .3, pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: `${seriesLabel} by month` } }, scales: { x: { ticks: walletMonthAxisTicks() } } } });
}

function renderWalletCharts() {
  if (typeof Chart === "undefined") return;
  const input = document.querySelector("#wallet-chart-month");
  if (!input) return;
  input.value ||= walletMonthKey();
  const key = input.value;
  renderWalletCategoryChart(key);
  renderWalletDailyChart(key);
  renderWalletMonthlyChart();
  renderWalletPeriodChart();
}

function renderWallet() {
  if (!state.data.wallet) state.data.wallet = { expenses: [], months: {} };
  renderWalletCurrent();
  renderWalletArchive();
  renderWalletExpenseList();
  renderWalletNotes();
  if (document.querySelector("#wallet-charts")?.classList.contains("active")) renderWalletCharts();
  renderLoans();
}

function getLoanSchedule(loan) {
  if (loan.status === "paid") return [];
  if (loan.method === "manual") return (loan.manualSchedule || []).filter((payment) => !payment.paid).map((payment) => ({ ...payment, loanId: loan.id }));
  if (loan.method !== "monthly") return [{ date: loan.dueDate, amount: normalizeNumber(loan.balance), loanId: loan.id }];
  const result = [];
  let balance = normalizeNumber(loan.balance);
  let cursor = new Date(`${loan.dueDate}T00:00:00`);
  const lastPaymentDate = loan.lastPaymentDate ? new Date(`${loan.lastPaymentDate}T23:59:59`) : null;
  const payment = Math.max(0.01, normalizeNumber(loan.monthlyPayment));
  while (balance > 0 && result.length < 120 && (!lastPaymentDate || cursor <= lastPaymentDate)) {
    result.push({ date: getDateString(cursor), amount: Math.min(payment, balance), loanId: loan.id });
    balance -= payment;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, Math.min(normalizeNumber(loan.paymentDay) || cursor.getDate(), 28));
  }
  return result;
}

function renderLoans() {
  const list = document.querySelector("#loans-list");
  const calendar = document.querySelector("#loan-calendar");
  if (!list || !calendar) return;
  state.data.wallet.loans ||= [];
  list.innerHTML = state.data.wallet.loans.length ? state.data.wallet.loans.map((loan) => `<div class="loan-row"><div><strong>${escapeHtml(loan.name)}</strong><span>${escapeHtml(loan.institution || "—")} · ${escapeHtml(loan.comment || "")}</span></div><div><span>Balance</span><strong>${walletMoney(loan.balance)}</strong></div><input type="number" min="0.01" step="0.01" value="${normalizeNumber(loan.monthlyPayment) || normalizeNumber(loan.balance)}" data-loan-payment="${escapeHtml(loan.id)}"><button class="primary-btn" data-repay-loan="${escapeHtml(loan.id)}" ${loan.status === "paid" ? "disabled" : ""}>${loan.status === "paid" ? "Paid" : "Repay"}</button><button class="secondary-btn" data-edit-loan="${escapeHtml(loan.id)}">Edit</button><button class="danger-btn" data-delete-loan="${escapeHtml(loan.id)}">Delete</button></div>`).join("") : '<p class="empty-state">No loans.</p>';
  list.querySelectorAll("[data-repay-loan]").forEach((button) => button.addEventListener("click", async () => {
    const loan = state.data.wallet.loans.find((item) => item.id === button.dataset.repayLoan);
    const amount = normalizeNumber(list.querySelector(`[data-loan-payment="${loan?.id}"]`)?.value);
    if (!loan || amount <= 0) return showNotice("Enter a valid repayment amount.", "Loan repayment");
    loan.balance = Math.max(0, normalizeNumber(loan.balance) - amount);
    loan.repayments ||= [];
    loan.repayments.push({ id: `repayment-${Date.now()}`, date: getDateString(), amount });
    if (loan.method === "manual") {
      const scheduled = (loan.manualSchedule || []).filter((payment) => !payment.paid).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (scheduled) {
        if (amount >= normalizeNumber(scheduled.amount)) scheduled.paid = true;
        else scheduled.amount = normalizeNumber(scheduled.amount) - amount;
      }
    }
    if (loan.balance === 0) loan.status = "paid";
    await api.saveWallet(state.data.wallet);
    renderLoans();
  }));
  list.querySelectorAll("[data-edit-loan]").forEach((button) => button.addEventListener("click", () => openLoanModal(button.dataset.editLoan)));
  list.querySelectorAll("[data-delete-loan]").forEach((button) => button.addEventListener("click", async () => {
    if (!(await showConfirm("Delete this loan and its repayment history?", "Delete loan"))) return;
    state.data.wallet.loans = state.data.wallet.loans.filter((loan) => loan.id !== button.dataset.deleteLoan);
    await api.saveWallet(state.data.wallet);
    renderLoans();
  }));
  const upcoming = state.data.wallet.loans.flatMap((loan) => getLoanSchedule(loan)).filter((payment) => payment.date >= getDateString()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  calendar.innerHTML = upcoming.length ? upcoming.map((payment) => { const loan = state.data.wallet.loans.find((item) => item.id === payment.loanId); return `<div class="loan-payment"><span>${formatWalletDate(payment.date)} · ${escapeHtml(loan?.name || "Loan")}</span><strong>${walletMoney(payment.amount)}</strong></div>`; }).join("") : '<p class="empty-state">No upcoming loan payments.</p>';
}

function updateLoanMethodFields() {
  const method = document.querySelector("#loan-method")?.value;
  ["#loan-monthly-payment-field", "#loan-payment-day-field", "#loan-last-payment-field"].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.hidden = method !== "monthly";
  });
  const manual = document.querySelector("#loan-manual-schedule-field");
  if (manual) manual.hidden = method !== "manual";
  const form = document.querySelector("#loan-form");
  if (form) {
    form.elements.monthlyPayment.required = method === "monthly";
    form.elements.paymentDay.required = method === "monthly";
    form.elements.lastPaymentDate.required = method === "monthly";
    form.elements.manualSchedule.required = method === "manual";
  }
}

function openLoanModal(loanId = null) {
  const modal = document.querySelector("#loan-modal");
  const form = document.querySelector("#loan-form");
  if (!modal || !form) return;
  const loan = (state.data.wallet.loans || []).find((item) => item.id === loanId);
  state.editingLoanId = loan?.id || null;
  form.reset();
  form.elements.name.value = loan?.name || "";
  form.elements.amount.value = loan?.amount || "";
  form.elements.method.value = loan?.method || "once";
  form.elements.institution.value = loan?.institution || "";
  form.elements.dueDate.value = loan?.dueDate || getDateString();
  form.elements.monthlyPayment.value = loan?.monthlyPayment || "";
  form.elements.paymentDay.value = loan?.paymentDay || "";
  form.elements.lastPaymentDate.value = loan?.lastPaymentDate || "";
  form.elements.manualSchedule.value = (loan?.manualSchedule || []).map((payment) => `${payment.date}, ${payment.amount}`).join("\n");
  form.elements.comment.value = loan?.comment || "";
  modal.querySelector("h2").textContent = loan ? "Edit loan" : "Add loan";
  form.querySelector('[type="submit"]').textContent = loan ? "Save changes" : "Save loan";
  updateLoanMethodFields();
  modal.classList.add("open");
}

function setupLoans() {
  const modal = document.querySelector("#loan-modal");
  const form = document.querySelector("#loan-form");
  const close = () => { modal?.classList.remove("open"); form?.reset(); state.editingLoanId = null; };
  document.querySelector("#add-loan-btn")?.addEventListener("click", () => openLoanModal());
  document.querySelector("#loan-method")?.addEventListener("change", updateLoanMethodFields);
  document.querySelector("#close-loan-modal")?.addEventListener("click", close);
  document.querySelector("#cancel-loan")?.addEventListener("click", close);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const amount = normalizeNumber(values.get("amount"));
    state.data.wallet.loans ||= [];
    const manualSchedule = String(values.get("manualSchedule") || "").split(/\r?\n/).map((line) => { const [date, value] = line.split(",").map((part) => part.trim()); return { id: `loan-payment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date, amount: normalizeNumber(value), paid: false }; }).filter((payment) => payment.date && payment.amount > 0);
    const previous = state.data.wallet.loans.find((loan) => loan.id === state.editingLoanId);
    const paidAmount = previous ? normalizeNumber(previous.amount) - normalizeNumber(previous.balance) : 0;
    const loan = { id: previous?.id || `loan-${Date.now()}`, createdAt: previous?.createdAt || new Date().toISOString(), name: String(values.get("name") || "").trim(), amount, balance: Math.max(0, amount - paidAmount), method: values.get("method"), institution: String(values.get("institution") || "").trim(), dueDate: values.get("dueDate"), monthlyPayment: normalizeNumber(values.get("monthlyPayment")), paymentDay: normalizeNumber(values.get("paymentDay")), lastPaymentDate: values.get("lastPaymentDate") || null, manualSchedule, comment: String(values.get("comment") || "").trim(), repayments: previous?.repayments || [], status: amount > paidAmount ? "active" : "paid" };
    if (previous) state.data.wallet.loans[state.data.wallet.loans.indexOf(previous)] = loan;
    else state.data.wallet.loans.push(loan);
    await api.saveWallet(state.data.wallet);
    close();
    renderLoans();
  });
}

function openExpenseModal(expenseId = null) {
  const modal = document.querySelector("#expense-modal");
  const form = document.querySelector("#expense-form");
  const expense = (state.data.wallet.expenses || []).find((item) => item.id === expenseId);
  state.editingExpenseId = expense?.id || null;
  form.reset();
  form.elements.date.value = expense?.date || getDateString();
  const key = String(form.elements.date.value).slice(0, 7);
  const categories = walletCategories(key);
  document.querySelector("#expense-category").innerHTML = categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("");
  const groceries = categories.find((category) => category === "Groceries + household") || categories.find((category) => category.toLowerCase().startsWith("groceries"));
  form.elements.category.value = expense?.category || groceries || form.elements.category.value;
  form.elements.amount.value = expense?.amount || "";
  form.elements.note.value = expense?.note || "";
  document.querySelector("#expense-modal-title").textContent = expense ? "Edit expense" : "Record expense";
  document.querySelector("#new-category-field").hidden = true;
  modal.classList.add("open");
}

function setupWallet() {
  const investments = document.querySelector("#investments-app");
  const walletApp = document.querySelector("#wallet-app");
  investments.hidden = true;
  walletApp.hidden = false;
  document.querySelector("#open-wallet")?.addEventListener("click", () => {
    investments.hidden = true;
    walletApp.hidden = false;
    document.querySelectorAll(".wallet-tab").forEach((item) => item.classList.toggle("active", item.dataset.walletTab === "current"));
    document.querySelectorAll(".wallet-page").forEach((page) => page.classList.toggle("active", page.id === "wallet-current"));
    renderWallet();
  });
  document.querySelector("#open-investments")?.addEventListener("click", () => {
    walletApp.hidden = true;
    investments.hidden = false;
    document.querySelectorAll("#investments-app .nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === "dashboard"));
    document.querySelectorAll("#investments-app .page-section").forEach((page) => page.classList.toggle("active", page.id === "dashboard-section"));
    const title = document.querySelector("#page-title");
    if (title) title.textContent = "Dashboard";
    renderDashboard();
  });
  document.querySelectorAll(".wallet-tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".wallet-tab").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".wallet-page").forEach((page) => page.classList.toggle("active", page.id === `wallet-${button.dataset.walletTab}`));
    if (button.dataset.walletTab === "archive") renderWalletArchive();
    if (button.dataset.walletTab === "charts") renderWalletCharts();
  }));
  document.querySelector("#wallet-archive-month")?.addEventListener("change", renderWalletArchive);
  document.querySelector("#wallet-current-month")?.addEventListener("change", () => { renderWalletCurrent(); renderWalletNotes(); });
  document.querySelector("#wallet-expenses-month")?.addEventListener("change", renderWalletExpenseList);
  document.querySelector("#wallet-chart-month")?.addEventListener("change", renderWalletCharts);
  document.querySelector("#wallet-monthly-category")?.addEventListener("change", renderWalletMonthlyChart);
  document.querySelector("#wallet-period-preset")?.addEventListener("change", () => {
    applyWalletPeriodPreset();
    renderWalletPeriodChart();
  });
  ["#wallet-period-from", "#wallet-period-to"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => {
      const preset = document.querySelector("#wallet-period-preset");
      if (preset) preset.value = "custom";
      renderWalletPeriodChart();
    });
  });
  document.querySelector("#wallet-note-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#wallet-note-text");
    const text = input.value.trim();
    if (!text) return;
    const key = document.querySelector("#wallet-current-month")?.value || walletMonthKey();
    walletMonth(key).notes.push({ id: `wallet-note-${Date.now()}`, text });
    await api.saveWallet(state.data.wallet);
    input.value = "";
    renderWalletNotes();
  });

  const modal = document.querySelector("#expense-modal");
  const form = document.querySelector("#expense-form");
  const close = () => { modal.classList.remove("open"); form.reset(); state.editingExpenseId = null; };
  document.querySelector("#add-expense-btn")?.addEventListener("click", () => openExpenseModal());
  document.querySelector("#close-expense-modal")?.addEventListener("click", close);
  document.querySelector("#cancel-expense")?.addEventListener("click", close);
  document.querySelector("#use-new-category")?.addEventListener("change", (event) => { document.querySelector("#new-category-field").hidden = !event.target.checked; });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const date = values.get("date");
    const key = String(date).slice(0, 7);
    let category = String(values.get("category") || "");
    if (document.querySelector("#use-new-category").checked) {
      category = document.querySelector("#new-expense-category").value.trim();
      if (!category) return showNotice("Enter a new category name.");
      walletMonth(key).customCategories.push(category);
    }
    const expense = { id: state.editingExpenseId || `expense-${Date.now()}`, date, category, amount: normalizeNumber(values.get("amount")), note: values.get("note") || "", currency: "UAH" };
    if (state.editingExpenseId) {
      const index = state.data.wallet.expenses.findIndex((item) => item.id === state.editingExpenseId);
      if (index >= 0) state.data.wallet.expenses[index] = { ...state.data.wallet.expenses[index], ...expense };
    } else {
      state.data.wallet.expenses.push(expense);
    }
    cleanupUnusedWalletCategories();
    await api.saveWallet(state.data.wallet);
    close();
    renderWallet();
  });
}

document.addEventListener("DOMContentLoaded", init);
