async function refreshApplicationData() {
  const context = stateStore.capture();
  if (!stateStore.getState().portfolioLoaded) stateStore.setUI({ portfolioLoadState: 'loading' });
  let result;
  try { result = await stateStore.loadData(() => api.getData({ sync: false })); }
  catch (error) {
    if (stateStore.isCurrent(context)) stateStore.setUI({ portfolioLoadState: 'error', portfolioLoadError: globalThis.FinoErrors?.clientError(error) || { message: 'Could not load asset details.' } });
    throw error;
  }
  if (!result.applied) return result;
  stateStore.setUI({ portfolioLoaded: true, portfolioLoadState: 'ready', portfolioLoadError: null });
  // Cached holdings should render before optional network requests complete.
  // loadPurchaseExchangeRates restores its cache synchronously before fetching.
  const snapshot = stateStore.capture();
  const history = loadPurchaseExchangeRates();
  void Promise.all([api.getExchangeRates().catch(error => {
    console.warn('Using fallback exchange rates:', window.FinoErrors.diagnostics(error));
    return null;
  }), history]).then(([exchangeData]) => {
    if (!stateStore.isCurrent(snapshot)) return;
    if (exchangeData?.rates) {
      EXCHANGE_RATES.USD = normalizeNumber(exchangeData.rates.USD) || EXCHANGE_RATES.USD;
      EXCHANGE_RATES.EUR = normalizeNumber(exchangeData.rates.EUR) || EXCHANGE_RATES.EUR;
    }
    stateStore.setUI({ marketRevision: (state.marketRevision || 0) + 1,
      exchangeRateDate: exchangeData?.exchangeDate || null, exchangeRateSource: exchangeData?.source || null });
  }).catch(error => console.warn('Could not refresh market-dependent views:', window.FinoErrors.diagnostics(error)));
  return result;
}

// data-loader.js
async function loadPurchaseExchangeRates() {
  const snapshot = stateStore.capture();
  const cacheKey = "fino-purchase-exchange-rates-v1";
  try {
    const cachedRates = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    if (cachedRates && typeof cachedRates === "object" && !Array.isArray(cachedRates)) stateStore.setUI({ purchaseExchangeRates: cachedRates });
  } catch (_) {
    stateStore.setUI({ purchaseExchangeRates: {} });
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
      if (!stateStore.isCurrent(snapshot)) return;
      const rates = (result.values || [])
        .map((item) => ({ date: String(item.datetime || "").slice(0, 10), rate: normalizeNumber(item.close) }))
        .filter((item) => item.date && item.rate > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      stateStore.setUI({ purchaseExchangeRates: { ...state.purchaseExchangeRates, [currency]: rates } });
      localStorage.setItem(cacheKey, JSON.stringify(state.purchaseExchangeRates));
    } catch (error) {
      console.warn(`Could not load historical ${currency}/UAH rates:`, window.FinoErrors.diagnostics(error));
    }
  }));
}

async function updateSp500Benchmark() {
  const snapshot = stateStore.capture();
  const data = stateStore.getData();
  const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const savings = new Set((data.assets || []).filter(item => item.type === 'savings').map(item => item.id));
  const buys = (data.transactions || []).filter(item => item.type === 'BUY' &&
    !savings.has(item.assetId) && (globalThis.FinoStateContract?.isTransactionCompleted(item) ?? !['pending', 'planned', 'cancelled'].includes(item.status)) && isDate(item.date));
  const recorded = new Set(buys.map(item => item.assetId));
  const dates = [...buys.map(item => item.date), ...(data.assets || []).filter(item => item.type !== 'savings' && !recorded.has(item.id)).map(item => item.purchaseDate).filter(isDate)].sort();
  const start = dates[0], end = getDateString(new Date());
  const samePeriod = state.sp500BenchmarkPeriod === `${start}:${end}`;
  stateStore.setUI({ sp500Benchmark: samePeriod ? state.sp500Benchmark : null, sp500BenchmarkStatus: start && start <= end ? 'loading' : 'empty',
    sp500BenchmarkPeriod: `${start}:${end}`, sp500BenchmarkStart: start || null, sp500BenchmarkEnd: end });
  if (!start || start > end) return;
  try {
    const result = await api.getIndexHistory({ symbol: ".INX", startDate: start, endDate: end });
    if (!stateStore.isCurrent(snapshot)) return;
    const values = (result.values || []).map(point => ({ date: String(point.datetime || point.date || '').slice(0, 10), close: Number(point.close) }))
      .filter(point => isDate(point.date) && point.date >= start && point.date <= end && Number.isFinite(point.close) && point.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    stateStore.setUI({ sp500Benchmark: values.length > 1 ? (values.at(-1).close / values[0].close - 1) * 100 : null,
      sp500BenchmarkStatus: values.length > 1 ? 'ready' : 'unavailable', sp500BenchmarkStart: values[0]?.date || start, sp500BenchmarkEnd: values.at(-1)?.date || end });
  } catch (error) {
    if (!stateStore.isCurrent(snapshot)) return;
    stateStore.setUI({ sp500BenchmarkStatus: 'unavailable' });
    console.warn("Could not load the S&P 500 benchmark:", window.FinoErrors.diagnostics(error));
  }
}
