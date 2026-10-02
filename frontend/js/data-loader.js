async function refreshApplicationData() {
  const data = await api.getData({ sync: false });
  stateStore.replaceData(data);
  normalizeWalletCategoryNames();
  // Cached holdings should render before optional network requests complete.
  // loadPurchaseExchangeRates restores its cache synchronously before fetching.
  const snapshot = state.data;
  const history = loadPurchaseExchangeRates();
  void Promise.all([api.getExchangeRates().catch(error => {
    console.warn('Using fallback exchange rates:', error.message);
    return null;
  }), history]).then(([exchangeData]) => {
    if (state.data !== snapshot) return;
    if (exchangeData?.rates) {
      EXCHANGE_RATES.USD = normalizeNumber(exchangeData.rates.USD) || EXCHANGE_RATES.USD;
      EXCHANGE_RATES.EUR = normalizeNumber(exchangeData.rates.EUR) || EXCHANGE_RATES.EUR;
    }
    renderDashboard();
    renderPortfolio();
    renderTransactions();
    renderProfitCalculator();
    renderWallet();
  }).catch(error => console.warn('Could not refresh market-dependent views:', error.message));
}

// data-loader.js
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
    const endDate = today;

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

async function refreshGoogleDriveStatus() {
  try { renderGoogleDriveStatus(await api.getGoogleDriveStatus()); }
  catch (_) { renderGoogleDriveStatus({ connected: false, error: true }); }
}
