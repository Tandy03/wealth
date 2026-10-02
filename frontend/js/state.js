// state.js
const state = {
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
  purchaseExchangeRates: {},
};

const EXCHANGE_RATES = { ...window.FinoConstants.DEFAULT_EXCHANGE_RATES };

const HISTORICAL_RATE_FALLBACKS = { ...window.FinoConstants.DEFAULT_EXCHANGE_RATES };

const WALLET_CATEGORIES = window.FinoConstants.WALLET_CATEGORIES;

const stateStore = {
  replaceData(data) { state.data = FinoStateModel.normalizeState(data); return state.data; },
  getData() { return state.data; },
};
