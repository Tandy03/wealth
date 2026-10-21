// Bind live services to store readers; render services stay bound to their supplied snapshot.
function createRenderServices(snapshot) {
  const readers = { selectData: () => stateStore.selectData(snapshot), selectUI: key => stateStore.selectUI(key, snapshot) };
  const market = FinoMarketData.createService({ ...readers, exchangeRates: EXCHANGE_RATES, historicalRates: HISTORICAL_RATE_FALLBACKS, values: FinoValues, getCustomRange: () => readers.selectUI('marketCustomRange') });
  const finance = FinoPortfolioFinance.createService({ ...readers, market, values: FinoValues });
  return { ...market, ...finance,
    ...FinoCashflow.createService({ ...readers, market, finance, values: FinoValues }),
    ...FinoWalletAnalytics.createService({ ...readers, values: FinoValues, categories: WALLET_CATEGORIES }),
  };
}
const marketData = FinoMarketData.createService({ selectData: stateStore.selectData, selectUI: stateStore.selectUI, exchangeRates: EXCHANGE_RATES, historicalRates: HISTORICAL_RATE_FALLBACKS, values: FinoValues, getCustomRange: () => stateStore.selectUI('marketCustomRange') });
const portfolioFinance = FinoPortfolioFinance.createService({ selectData: stateStore.selectData, selectUI: stateStore.selectUI, market: marketData, values: FinoValues });
const cashflow = FinoCashflow.createService({ selectData: stateStore.selectData, selectUI: stateStore.selectUI, market: marketData, finance: portfolioFinance, values: FinoValues });
const walletAnalytics = FinoWalletAnalytics.createService({ selectData: stateStore.selectData, selectUI: stateStore.selectUI, values: FinoValues, categories: WALLET_CATEGORIES });
const { normalizeNumber, getDateString, isDateInRange } = FinoValues;
const { toUAH, getExchangeRateOnDate, toUAHAtDate, getAssetPurchaseDate, getAssetPurchaseExchangeRate, toUAHPurchaseCost, convertCurrency, marketParamsForRange, dateDaysAgo, currencyParamsForRange, resolveMarketSymbol, valuesForDates } = marketData;
const { getRebalanceGroups, calculateRebalancePlan, getAssetInvestedUah, getAssetInvestedUsd, getSoldQuantity, getCryptoEarnQuantity, getAvailableQuantity, getMaturityCostBasis, calculateInvested, calculateInvestedUsd, getCurrentPrice, calculatePortfolioValue, getUnrealizedPriceGrowth, getGroupedSaleCost } = portfolioFinance;
const { summarizeProfit, calculateXirr, calculatePortfolioXirr, calculateProfit, getTransactionEffectiveDate, getCalendarEvents, paymentToCalendarEvent, groupPaymentEvents } = cashflow;
const { walletMonthKey, walletMonth, walletCategories, walletExpenses, walletCategoryTotal, walletExpenseDateBounds, shiftWalletDate, getLoanSchedule } = walletAnalytics;
