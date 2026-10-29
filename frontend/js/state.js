// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createState({ FinoConstants, FinoStateModel, FinoStateStore, console, document, mobileApi }) {
// state.js
const stateStore = FinoStateStore.createStore({ model: FinoStateModel,
  guard: document.documentElement.dataset?.stateGuard === 'development' ? 'development' : false,
  onViolation: diagnostic => console.error('Financial state mutation:', diagnostic),
  getScope: () => mobileApi ? mobileApi.localAccountScope || null : 'desktop', initialState: {
  data: FinoStateModel.createEmptyState(),

  calendarDate: new Date(),
  calendarSelectedDate: null,

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
  portfolioLoaded: false,
  purchaseExchangeRates: {},
} });

const EXCHANGE_RATES = { ...FinoConstants.DEFAULT_EXCHANGE_RATES };

const HISTORICAL_RATE_FALLBACKS = { ...FinoConstants.DEFAULT_EXCHANGE_RATES };

const WALLET_CATEGORIES = FinoConstants.WALLET_CATEGORIES;
return { EXCHANGE_RATES, HISTORICAL_RATE_FALLBACKS, WALLET_CATEGORIES, stateStore };
}
