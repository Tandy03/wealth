// Composition root: only this module wires browser services and deferred UI callbacks.
import FinoErrors from '../../shared/errors.js';
import FinoOperations from '../../shared/operations.js';
import FinoSyncModel from '../../shared/sync-model.js';
import FinoStateContract from '../../shared/state-contract.js';
import FinoStateModel from '../../shared/state-model.js';
import FinoPortfolioTransfer from '../../shared/portfolio-transfer.js';
import FinoMarketModel from '../../shared/market-model.js';
import FinoConstants from '../../shared/constants.js';
import FinoValidation from './shared/validation.js';
import FinoOperationValidation from '../../shared/portfolio/validation.js';
import FinoPortfolioCalculations from '../../shared/portfolio/calculations.js';
import FinoPortfolioNormalization from '../../shared/portfolio/normalization.js';
import FinoPortfolioOperations from '../../shared/portfolio/operations.js';
import FinoPortfolioRules from '../../shared/portfolio-rules.js';
import FinoRequest from '../../shared/request.js';
import FinoWalletActions from './controllers/wallet-actions.js';
import FinoStateStore from './state-store.js';
import FinoFetchers from './api/fetchers.js';
import FinoDesktopApi from './api/desktop.js';
import FinoMobileApi from './api/mobile.js';
import FinoOutbox from './api/outbox.js';
import PortfolioPerformance from './portfolio-performance.js';
import FinoValues from './analytics/values.js';
import FinoMarketData from './market-data.js';
import FinoPortfolioFinance from './analytics/portfolio-finance.js';
import FinoAssetDetail from './asset-detail/model.js';
import FinoRebalanceModel from './rebalance/model.js';
import FinoCashflow from './cashflow.js';
import FinoWalletAnalytics from './wallet-analytics.js';
import FinoDashboardAnalytics from './analytics/dashboard.js';
import FinoWalletView from './views/wallet.js';
import FinoAssetDetailView from './asset-detail/view.js';
import FinoPortfolioShare from './share-card/data.js';
import shareCard from './share-card/card.js';
import sharePlatform from './share-card/platform.js';
import shareView from './share-card/view.js';
import { createI18n } from './i18n.js';
import { createMobileApi } from './mobile-api.js';
import { createApi } from './api.js';
import { createState } from './state.js';
import { createUtils } from './utils.js';
import { createModels } from './models.js';
import { createDataLoader } from './data-loader.js';
import { createRenderersDashboard } from './renderers/dashboard.js';
import { createRenderersPortfolio } from './renderers/portfolio.js';
import { createRenderersTransactions } from './renderers/transactions.js';
import { createRenderersCalendar } from './renderers/calendar.js';
import { createRenderersCalculators } from './renderers/calculators.js';
import { createRebalanceDashboard } from './rebalance/dashboard.js';
import { createRebalanceCurrencyHover } from './rebalance/currency-hover.js';
import { createRenderersSync } from './renderers/sync.js';
import { createRenderersWallet } from './renderers/wallet.js';
import { createFormsAssets } from './forms/assets.js';
import { createFormsBuy } from './forms/buy.js';
import { createFormsCalendar } from './forms/calendar.js';
import { createFormsSales } from './forms/sales.js';
import { createFormsCalculators } from './forms/calculators.js';
import { createFormsSettings } from './forms/settings.js';
import { createFormsWallet } from './forms/wallet.js';
import { createFormsLoans } from './forms/loans.js';
import { createChartsMarket } from './charts/market.js';
import { createChartsMacroeconomics } from './charts/macroeconomics.js';
import { createChartsPlugins } from './charts/plugins.js';
import { createChartsPortfolio } from './charts/portfolio.js';
import { createChartsWallet } from './charts/wallet.js';
import { createControllersActions } from './controllers/actions.js';
import { createControllersDashboard } from './controllers/dashboard.js';
import { createControllersWallet } from './controllers/wallet.js';
import { createControllersPortfolio } from './controllers/portfolio.js';
import { createControllersCalendar } from './controllers/calendar.js';
import { createControllersCalculators } from './controllers/calculators.js';
import { createControllersSync } from './controllers/sync.js';
import { createControllersApplication } from './controllers/application.js';
import { createUi } from './ui.js';
import { createApplication } from './app.js';
import { createMobileNavigation } from './navigation/mobile.js';

export const sharedModules = { FinoErrors, FinoOperations, FinoSyncModel, FinoStateContract, FinoStateModel, FinoPortfolioTransfer, FinoMarketModel, FinoConstants, FinoValidation, FinoOperationValidation, FinoPortfolioCalculations, FinoPortfolioNormalization, FinoPortfolioOperations, FinoPortfolioRules, FinoRequest };

export function createFrontend(window, options = {}) {
  const charts = { current: options.Chart };
  const ports = { ui: {}, charts, config: options.config || {}, window,
    MutationObserver: window.MutationObserver,
    NodeFilter: window.NodeFilter,
    document: window.document,
    localStorage: window.localStorage,
    location: window.location,
    URLSearchParams: window.URLSearchParams ?? globalThis.URLSearchParams,
    clearTimeout: window.clearTimeout?.bind(window) ?? globalThis.clearTimeout,
    console: window.console ?? globalThis.console,
    crypto: window.crypto ?? globalThis.crypto,
    setTimeout: window.setTimeout?.bind(window) ?? globalThis.setTimeout,
    CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle?.bind(window),
    sessionStorage: window.sessionStorage,
    requestAnimationFrame: window.requestAnimationFrame?.bind(window),
    FormData: window.FormData,
    Blob: window.Blob,
    FileReader: window.FileReader,
    URL: window.URL ?? globalThis.URL,
    FinoErrors,
    FinoOperations,
    FinoSyncModel,
    FinoStateContract,
    FinoStateModel,
    FinoPortfolioTransfer,
    FinoMarketModel,
    FinoConstants,
    FinoValidation,
    FinoOperationValidation,
    FinoPortfolioCalculations,
    FinoPortfolioNormalization,
    FinoPortfolioOperations,
    FinoPortfolioRules,
    FinoRequest,
    FinoWalletActions,
    FinoStateStore,
    FinoFetchers,
    FinoDesktopApi,
    FinoMobileApi,
    FinoOutbox,
    PortfolioPerformance,
    FinoValues,
    FinoMarketData,
    FinoPortfolioFinance,
    FinoAssetDetail,
    FinoRebalanceModel,
    FinoCashflow,
    FinoWalletAnalytics,
    FinoDashboardAnalytics,
    FinoWalletView,
    FinoAssetDetailView,
    FinoPortfolioShare: { ...FinoPortfolioShare, card: shareCard, platform: sharePlatform, view: shareView },
  };
  Object.assign(ports, createI18n({
    MutationObserver: ports.MutationObserver,
    NodeFilter: ports.NodeFilter,
    charts: ports.charts,
    document: ports.document,
    localStorage: ports.localStorage,
    location: ports.location,
  }));
  ports.initializeI18n();
  Object.assign(ports, createMobileApi({
    FinoConstants: ports.FinoConstants,
    FinoErrors: ports.FinoErrors,
    FinoMarketModel: ports.FinoMarketModel,
    FinoOperationValidation: ports.FinoOperationValidation,
    FinoOperations: ports.FinoOperations,
    FinoPortfolioRules: ports.FinoPortfolioRules,
    FinoPortfolioTransfer: ports.FinoPortfolioTransfer,
    FinoRequest: ports.FinoRequest,
    FinoStateModel: ports.FinoStateModel,
    FinoSyncModel: ports.FinoSyncModel,
    FinoValidation: ports.FinoValidation,
    URLSearchParams: ports.URLSearchParams,
    clearTimeout: ports.clearTimeout,
    config: ports.config,
    console: ports.console,
    crypto: ports.crypto,
    setTimeout: ports.setTimeout,
    window: ports.window,
  }));
  Object.assign(ports, createApi({
    CustomEvent: ports.CustomEvent,
    FinoDesktopApi: ports.FinoDesktopApi,
    FinoFetchers: ports.FinoFetchers,
    FinoMobileApi: ports.FinoMobileApi,
    FinoOperations: ports.FinoOperations,
    FinoOutbox: ports.FinoOutbox,
    FinoRequest: ports.FinoRequest,
    document: ports.document,
    loadData: (...args) => ports.loadData(...args),
    mobileApi: ports.mobileApi,
    window: ports.window,
  }));
  Object.assign(ports, createState({
    FinoConstants: ports.FinoConstants,
    FinoStateModel: ports.FinoStateModel,
    FinoStateStore: ports.FinoStateStore,
    console: ports.console,
    document: ports.document,
    mobileApi: ports.mobileApi,
  }));
  if (options.guardStore) ports.stateStore = options.guardStore(ports.stateStore);
  Object.assign(ports, createUtils({
    EXCHANGE_RATES: ports.EXCHANGE_RATES,
    FinoConstants: ports.FinoConstants,
    FinoI18n: ports.FinoI18n,
    getAvailableQuantity: (...args) => ports.getAvailableQuantity(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    toUAH: (...args) => ports.toUAH(...args),
  }));
  Object.assign(ports, createModels({
    EXCHANGE_RATES: ports.EXCHANGE_RATES,
    FinoCashflow: ports.FinoCashflow,
    FinoMarketData: ports.FinoMarketData,
    FinoPortfolioFinance: ports.FinoPortfolioFinance,
    FinoValues: ports.FinoValues,
    FinoWalletAnalytics: ports.FinoWalletAnalytics,
    HISTORICAL_RATE_FALLBACKS: ports.HISTORICAL_RATE_FALLBACKS,
    WALLET_CATEGORIES: ports.WALLET_CATEGORIES,
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createDataLoader({
    EXCHANGE_RATES: ports.EXCHANGE_RATES,
    FinoErrors: ports.FinoErrors,
    FinoStateContract: ports.FinoStateContract,
    api: ports.api,
    console: ports.console,
    getDateString: (...args) => ports.getDateString(...args),
    localStorage: ports.localStorage,
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createRenderersDashboard({
    FinoDashboardAnalytics: ports.FinoDashboardAnalytics,
    FinoI18n: ports.FinoI18n,
    bindDashboardHoldings: (...args) => ports.bindDashboardHoldings(...args),
    bindUpcomingPaymentActions: (...args) => ports.bindUpcomingPaymentActions(...args),
    createRenderServices: (...args) => ports.createRenderServices(...args),
    currencyFormatter: ports.currencyFormatter,
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    formatDate: (...args) => ports.formatDate(...args),
    formatQuantity: (...args) => ports.formatQuantity(...args),
    getDateString: (...args) => ports.getDateString(...args),
    money: (...args) => ports.money(...args),
    paymentTypeLabel: (...args) => ports.paymentTypeLabel(...args),
    portfolioMoneyWithUahHover: (...args) => ports.portfolioMoneyWithUahHover(...args),
    setupPortfolioCurrencyHover: (...args) => ports.setupPortfolioCurrencyHover(...args),
    stateStore: ports.stateStore,
    typeLabels: ports.typeLabels,
    usdMoney: (...args) => ports.usdMoney(...args),
  }));
  Object.assign(ports, createRenderersPortfolio({
    bindHoldingDetailActions: (...args) => ports.bindHoldingDetailActions(...args),
    bindPortfolioActions: (...args) => ports.bindPortfolioActions(...args),
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    formatDate: (...args) => ports.formatDate(...args),
    formatQuantity: (...args) => ports.formatQuantity(...args),
    getDateString: (...args) => ports.getDateString(...args),
    money: (...args) => ports.money(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    portfolioMoneyWithUahHover: (...args) => ports.portfolioMoneyWithUahHover(...args),
    stateStore: ports.stateStore,
    typeLabels: ports.typeLabels,
  }));
  Object.assign(ports, createRenderersTransactions({
    FinoI18n: ports.FinoI18n,
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    formatDate: (...args) => ports.formatDate(...args),
    money: (...args) => ports.money(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    paymentTypeLabel: (...args) => ports.paymentTypeLabel(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createRenderersCalendar({
    FinoI18n: ports.FinoI18n,
    bindCalendarDay: (...args) => ports.bindCalendarDay(...args),
    bindCalendarEventButton: (...args) => ports.bindCalendarEventButton(...args),
    bindCalendarPaymentAction: (...args) => ports.bindCalendarPaymentAction(...args),
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    formatDate: (...args) => ports.formatDate(...args),
    getDateString: (...args) => ports.getDateString(...args),
    money: (...args) => ports.money(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    paymentTypeLabel: (...args) => ports.paymentTypeLabel(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createRebalanceCurrencyHover({
    FinoI18n: ports.FinoI18n,
    api: ports.api,
    document: ports.document,
  }));
  Object.assign(ports, createRebalanceDashboard({
    FinoErrors: ports.FinoErrors,
    FinoI18n: ports.FinoI18n,
    FinoRebalanceCurrencyHover: ports.FinoRebalanceCurrencyHover,
    FinoRebalanceModel: ports.FinoRebalanceModel,
    FinoStateModel: ports.FinoStateModel,
    api: ports.api,
    charts: ports.charts,
    clearTimeout: ports.clearTimeout,
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    getComputedStyle: ports.getComputedStyle,
    mobileApi: ports.mobileApi,
    sessionStorage: ports.sessionStorage,
    setTimeout: ports.setTimeout,
    stateStore: ports.stateStore,
    window: ports.window,
  }));
  Object.assign(ports, createRenderersCalculators({
    FinoI18n: ports.FinoI18n,
    FinoRebalanceDashboard: ports.FinoRebalanceDashboard,
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    money: (...args) => ports.money(...args),
    renderAssetAllocationChart: (...args) => ports.renderAssetAllocationChart(...args),
    renderAssetPriceHistoryChart: (...args) => ports.renderAssetPriceHistoryChart(...args),
    renderPortfolioHistoryChart: (...args) => ports.renderPortfolioHistoryChart(...args),
    stateStore: ports.stateStore,
    typeLabels: ports.typeLabels,
  }));
  Object.assign(ports, createRenderersSync({
    FinoI18n: ports.FinoI18n,
    document: ports.document,
    ui: ports.ui,
  }));
  Object.assign(ports, createFormsAssets({
    DEFAULT_INSTRUMENTS: ports.DEFAULT_INSTRUMENTS,
    FinoErrors: ports.FinoErrors,
    FinoI18n: ports.FinoI18n,
    FinoOperations: ports.FinoOperations,
    FormData: ports.FormData,
    api: ports.api,
    console: ports.console,
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    financialCommand: (...args) => ports.financialCommand(...args),
    getAvailableQuantity: (...args) => ports.getAvailableQuantity(...args),
    getCurrentPrice: (...args) => ports.getCurrentPrice(...args),
    getDateString: (...args) => ports.getDateString(...args),
    groupHoldingsByInstrument: (...args) => ports.groupHoldingsByInstrument(...args),
    holdingGroupLabel: (...args) => ports.holdingGroupLabel(...args),
    loadData: (...args) => ports.loadData(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    openBuyMoreModal: (...args) => ports.openBuyMoreModal(...args),
    renderAssetTransactionsModal: (...args) => ports.renderAssetTransactionsModal(...args),
    showConfirm: (...args) => ports.showConfirm(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createFormsBuy({
    FinoErrors: ports.FinoErrors,
    FormData: ports.FormData,
    api: ports.api,
    console: ports.console,
    document: ports.document,
    financialCommand: (...args) => ports.financialCommand(...args),
    loadData: (...args) => ports.loadData(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createFormsCalendar({
    FinoErrors: ports.FinoErrors,
    FormData: ports.FormData,
    api: ports.api,
    console: ports.console,
    document: ports.document,
    financialCommand: (...args) => ports.financialCommand(...args),
    getDateString: (...args) => ports.getDateString(...args),
    loadData: (...args) => ports.loadData(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    renderCalendar: (...args) => ports.renderCalendar(...args),
    renderDashboard: (...args) => ports.renderDashboard(...args),
    renderProfitCalculator: (...args) => ports.renderProfitCalculator(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createFormsSales({
    FinoErrors: ports.FinoErrors,
    FinoI18n: ports.FinoI18n,
    api: ports.api,
    console: ports.console,
    document: ports.document,
    financialCommand: (...args) => ports.financialCommand(...args),
    formatQuantity: (...args) => ports.formatQuantity(...args),
    getAvailableQuantity: (...args) => ports.getAvailableQuantity(...args),
    getDateString: (...args) => ports.getDateString(...args),
    getGroupedSaleCost: (...args) => ports.getGroupedSaleCost(...args),
    loadData: (...args) => ports.loadData(...args),
    money: (...args) => ports.money(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createFormsCalculators({
    FinoI18n: ports.FinoI18n,
    FinoRebalanceDashboard: ports.FinoRebalanceDashboard,
    FormData: ports.FormData,
    document: ports.document,
    renderAssetAllocationChart: (...args) => ports.renderAssetAllocationChart(...args),
    renderAssetPriceHistoryChart: (...args) => ports.renderAssetPriceHistoryChart(...args),
    renderPortfolioHistoryChart: (...args) => ports.renderPortfolioHistoryChart(...args),
    renderProfitCalculator: (...args) => ports.renderProfitCalculator(...args),
    renderRebalanceCalculator: (...args) => ports.renderRebalanceCalculator(...args),
    requestAnimationFrame: ports.requestAnimationFrame,
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createFormsSettings({
    Blob: ports.Blob,
    FileReader: ports.FileReader,
    FinoErrors: ports.FinoErrors,
    FinoI18n: ports.FinoI18n,
    FinoPortfolioTransfer: ports.FinoPortfolioTransfer,
    URL: ports.URL,
    api: ports.api,
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    loadData: (...args) => ports.loadData(...args),
    localStorage: ports.localStorage,
    mobileApi: ports.mobileApi,
    refreshGoogleDriveStatus: (...args) => ports.refreshGoogleDriveStatus(...args),
    renderGoogleDriveStatus: (...args) => ports.renderGoogleDriveStatus(...args),
    renderProfitCalculator: (...args) => ports.renderProfitCalculator(...args),
    renderRebalanceCalculator: (...args) => ports.renderRebalanceCalculator(...args),
    renderWalletCharts: (...args) => ports.renderWalletCharts(...args),
    setTimeout: ports.setTimeout,
    stateStore: ports.stateStore,
    window: ports.window,
  }));
  Object.assign(ports, createChartsMarket({
    FinoErrors: ports.FinoErrors,
    FinoI18n: ports.FinoI18n,
    api: ports.api,
    charts: ports.charts,
    console: ports.console,
    currencyParamsForRange: (...args) => ports.currencyParamsForRange(...args),
    dateDaysAgo: (...args) => ports.dateDaysAgo(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    formatMarketPrice: (...args) => ports.formatMarketPrice(...args),
    getComputedStyle: ports.getComputedStyle,
    marketParamsForRange: (...args) => ports.marketParamsForRange(...args),
    resolveMarketSymbol: (...args) => ports.resolveMarketSymbol(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createChartsMacroeconomics({
    api: ports.api,
    charts: ports.charts,
    currencyFormatter: ports.currencyFormatter,
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    stateStore: ports.stateStore,
    valuesForDates: (...args) => ports.valuesForDates(...args),
  }));
  Object.assign(ports, createChartsPlugins({
    document: ports.document,
  }));
  Object.assign(ports, createChartsPortfolio({
    FinoChartPlugins: ports.FinoChartPlugins,
    FinoI18n: ports.FinoI18n,
    PortfolioPerformance: ports.PortfolioPerformance,
    charts: ports.charts,
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    getComputedStyle: ports.getComputedStyle,
    getDateString: (...args) => ports.getDateString(...args),
    money: (...args) => ports.money(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    stateStore: ports.stateStore,
    typeLabels: ports.typeLabels,
    window: ports.window,
  }));
  Object.assign(ports, createChartsWallet({
    FinoChartPlugins: ports.FinoChartPlugins,
    charts: ports.charts,
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    shiftWalletDate: (...args) => ports.shiftWalletDate(...args),
    stateStore: ports.stateStore,
    walletExpenseDateBounds: (...args) => ports.walletExpenseDateBounds(...args),
    walletMoney: (...args) => ports.walletMoney(...args),
    window: ports.window,
  }));
  Object.assign(ports, createControllersActions({
    FinoErrors: ports.FinoErrors,
    FinoWalletActions: ports.FinoWalletActions,
    api: ports.api,
    console: ports.console,
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createRenderersWallet({
    FinoI18n: ports.FinoI18n,
    FinoWalletView: ports.FinoWalletView,
    bindLoanActions: (...args) => ports.bindLoanActions(...args),
    bindWalletExpenseActions: (...args) => ports.bindWalletExpenseActions(...args),
    bindWalletNoteActions: (...args) => ports.bindWalletNoteActions(...args),
    bindWalletPlanActions: (...args) => ports.bindWalletPlanActions(...args),
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    formatWalletDate: (...args) => ports.formatWalletDate(...args),
    getDateString: (...args) => ports.getDateString(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    renderWalletCharts: (...args) => ports.renderWalletCharts(...args),
    requestAnimationFrame: ports.requestAnimationFrame,
    stateStore: ports.stateStore,
    walletActions: ports.walletActions,
    walletMoney: (...args) => ports.walletMoney(...args),
  }));
  Object.assign(ports, createFormsWallet({
    FinoErrors: ports.FinoErrors,
    FinoWalletActions: ports.FinoWalletActions,
    FormData: ports.FormData,
    console: ports.console,
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    getDateString: (...args) => ports.getDateString(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    renderWallet: (...args) => ports.renderWallet(...args),
    renderWalletNotes: (...args) => ports.renderWalletNotes(...args),
    setupWalletNavigation: (...args) => ports.setupWalletNavigation(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
    walletActions: ports.walletActions,
    walletCategories: (...args) => ports.walletCategories(...args),
    walletMonthKey: (...args) => ports.walletMonthKey(...args),
  }));
  Object.assign(ports, createFormsLoans({
    FormData: ports.FormData,
    document: ports.document,
    getDateString: (...args) => ports.getDateString(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    renderLoans: (...args) => ports.renderLoans(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
    walletActions: ports.walletActions,
  }));
  Object.assign(ports, createControllersDashboard({
    showCalendarEvent: (...args) => ports.showCalendarEvent(...args),
    stateStore: ports.stateStore,
    ui: ports.ui,
  }));
  Object.assign(ports, createControllersWallet({
    window: ports.window,
    FinoWalletActions: ports.FinoWalletActions,
    applyWalletPeriodPreset: (...args) => ports.applyWalletPeriodPreset(...args),
    document: ports.document,
    getDateString: (...args) => ports.getDateString(...args),
    normalizeNumber: (...args) => ports.normalizeNumber(...args),
    openExpenseModal: (...args) => ports.openExpenseModal(...args),
    openLoanModal: (...args) => ports.openLoanModal(...args),
    renderDashboard: (...args) => ports.renderDashboard(...args),
    renderLoans: (...args) => ports.renderLoans(...args),
    renderWallet: (...args) => ports.renderWallet(...args),
    renderWalletArchive: (...args) => ports.renderWalletArchive(...args),
    renderWalletCharts: (...args) => ports.renderWalletCharts(...args),
    renderWalletCurrent: (...args) => ports.renderWalletCurrent(...args),
    renderWalletExpenseList: (...args) => ports.renderWalletExpenseList(...args),
    renderWalletMonthlyChart: (...args) => ports.renderWalletMonthlyChart(...args),
    renderWalletNotes: (...args) => ports.renderWalletNotes(...args),
    renderWalletPeriodChart: (...args) => ports.renderWalletPeriodChart(...args),
    runUiAction: (...args) => ports.runUiAction(...args),
    showConfirm: (...args) => ports.showConfirm(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
    walletActions: ports.walletActions,
  }));
  Object.assign(ports, createControllersPortfolio({
    api: ports.api,
    document: ports.document,
    loadData: (...args) => ports.loadData(...args),
    openEditAssetModal: (...args) => ports.openEditAssetModal(...args),
    openHoldingSelectionModal: (...args) => ports.openHoldingSelectionModal(...args),
    showConfirm: (...args) => ports.showConfirm(...args),
    stateStore: ports.stateStore,
    ui: ports.ui,
  }));
  Object.assign(ports, createControllersCalendar({
    document: ports.document,
    getDateString: (...args) => ports.getDateString(...args),
    markPaymentAsReceived: (...args) => ports.markPaymentAsReceived(...args),
    openNoteModal: (...args) => ports.openNoteModal(...args),
    renderCalendar: (...args) => ports.renderCalendar(...args),
    showCalendarEvent: (...args) => ports.showCalendarEvent(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createControllersCalculators({
    FinoRebalanceDashboard: ports.FinoRebalanceDashboard,
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createControllersSync({
    api: ports.api,
    renderGoogleDriveStatus: (...args) => ports.renderGoogleDriveStatus(...args),
    stateStore: ports.stateStore,
  }));
  Object.assign(ports, createControllersApplication({
    FinoErrors: ports.FinoErrors,
    FinoI18n: ports.FinoI18n,
    MutationObserver: ports.MutationObserver,
    api: ports.api,
    console: ports.console,
    document: ports.document,
    loadData: (...args) => ports.loadData(...args),
    populateMarketSymbols: (...args) => ports.populateMarketSymbols(...args),
    populateSellAssetSelect: (...args) => ports.populateSellAssetSelect(...args),
    renderCalendar: (...args) => ports.renderCalendar(...args),
    renderMacroeconomics: (...args) => ports.renderMacroeconomics(...args),
    renderMarketChart: (...args) => ports.renderMarketChart(...args),
    renderPortfolio: (...args) => ports.renderPortfolio(...args),
    renderProfitCalculator: (...args) => ports.renderProfitCalculator(...args),
    renderRebalanceCalculator: (...args) => ports.renderRebalanceCalculator(...args),
    requestAnimationFrame: ports.requestAnimationFrame,
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
    ui: ports.ui,
    window: ports.window,
  }));
  Object.assign(ports.ui, createUi({
    EXCHANGE_RATES: ports.EXCHANGE_RATES,
    FinoAssetDetail: ports.FinoAssetDetail,
    FinoAssetDetailView: ports.FinoAssetDetailView,
    FinoI18n: ports.FinoI18n,
    FinoPortfolioShare: ports.FinoPortfolioShare,
    HISTORICAL_RATE_FALLBACKS: ports.HISTORICAL_RATE_FALLBACKS,
    charts: ports.charts,
    convertCurrency: (...args) => ports.convertCurrency(...args),
    createRenderServices: (...args) => ports.createRenderServices(...args),
    document: ports.document,
    escapeHtml: (...args) => ports.escapeHtml(...args),
    getAvailableQuantity: (...args) => ports.getAvailableQuantity(...args),
    getDateString: (...args) => ports.getDateString(...args),
    loadData: (...args) => ports.loadData(...args),
    markPaymentAsReceived: (...args) => ports.markPaymentAsReceived(...args),
    mobileApi: ports.mobileApi,
    openBuyMoreModal: (...args) => ports.openBuyMoreModal(...args),
    openEditAssetModal: (...args) => ports.openEditAssetModal(...args),
    openExpenseModal: (...args) => ports.openExpenseModal(...args),
    openHoldingSelectionModal: (...args) => ports.openHoldingSelectionModal(...args),
    openNoteModal: (...args) => ports.openNoteModal(...args),
    openSellAssetModal: (...args) => ports.openSellAssetModal(...args),
    renderAssetTransactionsModal: (...args) => ports.renderAssetTransactionsModal(...args),
    renderCalendar: (...args) => ports.renderCalendar(...args),
    renderDashboard: (...args) => ports.renderDashboard(...args),
    renderGoogleDriveStatus: (...args) => ports.renderGoogleDriveStatus(...args),
    renderPortfolio: (...args) => ports.renderPortfolio(...args),
    renderProfitCalculator: (...args) => ports.renderProfitCalculator(...args),
    renderRebalanceCalculator: (...args) => ports.renderRebalanceCalculator(...args),
    renderTransactions: (...args) => ports.renderTransactions(...args),
    renderUpcomingPayments: (...args) => ports.renderUpcomingPayments(...args),
    renderWallet: (...args) => ports.renderWallet(...args),
    setupBuyMoreModal: (...args) => ports.setupBuyMoreModal(...args),
    setupModal: (...args) => ports.setupModal(...args),
    setupNoteModal: (...args) => ports.setupNoteModal(...args),
    setupSellModal: (...args) => ports.setupSellModal(...args),
    setupSettingsModal: (...args) => ports.setupSettingsModal(...args),
    setupWallet: (...args) => ports.setupWallet(...args),
    showCalendarEvent: (...args) => ports.showCalendarEvent(...args),
    showNotice: (...args) => ports.showNotice(...args),
    stateStore: ports.stateStore,
    typeLabels: ports.typeLabels,
    window: ports.window,
  }).ui);
  Object.assign(ports, createMobileNavigation({ window: ports.window, document: ports.document, i18n: ports.FinoI18n }));
  const application = createApplication({
    store: ports.stateStore,
    api: ports.api,
    refreshData: ports.refreshApplicationData,
    render: ports.renderApplication,
    initializeController: ports.initializeUiController,
    diagnostics: FinoErrors.diagnostics,
    logger: ports.console,
    showNotice: ports.showNotice,
    isNative: () => Boolean(ports.mobileApi),
    controllers: [
      ['Notice modal', ports.setupNoticeModal], ['Modal backdrop', ports.setupModalBackdropClosing],
      ['Global errors', ports.setupGlobalErrorHandling], ['Number inputs', ports.disableNumberInputWheelChanges],
      ['Render subscriptions', ports.setupRenderSubscriptions], ['Google Drive', ports.setupGoogleDriveSync],
      ['Settings', ports.setupSettingsModal], ['Responsive tables', ports.setupResponsiveTables],
      ['Navigation', ports.setupNavigation], ['Asset form', ports.setupModal], ['Buy form', ports.setupBuyMoreModal],
      ['Calendar', ports.setupCalendarNavigation], ['Event modal', ports.setupEventModal], ['Note form', ports.setupNoteModal],
      ['Sale form', ports.setupSellModal], ['Profit calculator', ports.setupProfitCalculator],
      ['Portfolio sort', ports.setupPortfolioSort], ['Rebalance', ports.setupRebalanceCalculator],
      ['Market', ports.setupMarket], ['Asset sync', ports.setupInzhurSync], ['Theme', ports.setupThemeToggle],
      ['Asset transactions', ports.setupAssetTransactionsModal], ['Holding selection', ports.setupDeleteHoldingModal],
      ['Wallet', ports.setupWallet], ['Loans', ports.setupLoans],
      ['Command recovery', ports.setupCommandRecovery],
      ['Asset details', ports.ui.asset.setup],
      ['Portfolio share', ports.ui.share.setup],
      ['Mobile navigation', ports.setupMobileNavigation],
    ],
  });
  ports.ui.application = application;
  Object.assign(ports, application, { application });
  Object.defineProperty(ports, "Chart", { get: () => charts.current, set: value => { charts.current = value; } });
  return ports;
}
