// state.js
const stateStore = FinoStateStore.createStore({ model: FinoStateModel,
  guard: document.documentElement.dataset?.stateGuard === 'development' ? 'development' : false,
  onViolation: diagnostic => console.error('Financial state mutation:', diagnostic),
  getScope: () => window.mobileApi ? window.mobileApi.localAccountScope || null : 'desktop', initialState: {
  data: FinoStateModel.createEmptyState(),

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
  portfolioLoaded: false,
  purchaseExchangeRates: {},
} });
// Compatibility alias for existing forms and DOM-free services during incremental extraction.
const state = stateStore.getState();

const EXCHANGE_RATES = { ...window.FinoConstants.DEFAULT_EXCHANGE_RATES };

const HISTORICAL_RATE_FALLBACKS = { ...window.FinoConstants.DEFAULT_EXCHANGE_RATES };

const WALLET_CATEGORIES = window.FinoConstants.WALLET_CATEGORIES;
