// Bind DOM-free services to the application's single state object.
const marketData = FinoMarketData.createService({ state, exchangeRates: EXCHANGE_RATES, historicalRates: HISTORICAL_RATE_FALLBACKS, values: FinoValues, getCustomRange: () => marketCustomRange });
const portfolioFinance = FinoPortfolioFinance.createService({ state, market: marketData, values: FinoValues });
const cashflow = FinoCashflow.createService({ state, market: marketData, finance: portfolioFinance, values: FinoValues });
const walletAnalytics = FinoWalletAnalytics.createService({ state, values: FinoValues, categories: WALLET_CATEGORIES });
const { normalizeNumber, getDateString, isDateInRange } = FinoValues;
const { toUAH, getExchangeRateOnDate, toUAHAtDate, getAssetPurchaseDate, getAssetPurchaseExchangeRate, toUAHPurchaseCost, convertCurrency, marketParamsForRange, dateDaysAgo, currencyParamsForRange, resolveMarketSymbol, valuesForDates } = marketData;
const { getRebalanceGroups, calculateRebalancePlan, getAssetInvestedUah, getAssetInvestedUsd, getSoldQuantity, getCryptoEarnQuantity, getAvailableQuantity, getMaturityCostBasis, calculateInvested, calculateInvestedUsd, getCurrentPrice, calculatePortfolioValue, getUnrealizedPriceGrowth, getGroupedSaleCost } = portfolioFinance;
const { summarizeProfit, calculateXirr, calculatePortfolioXirr, calculateProfit, getTransactionEffectiveDate, getCalendarEvents, paymentToCalendarEvent, groupPaymentEvents } = cashflow;
const { walletMonthKey, normalizeWalletCategoryNames, walletMonth, walletCategories, walletExpenses, walletCategoryTotal, cleanupUnusedWalletCategories, walletExpenseDateBounds, shiftWalletDate, getLoanSchedule } = walletAnalytics;
