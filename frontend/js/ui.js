// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createUi({
  EXCHANGE_RATES,
  FinoAssetDetail,
  FinoAssetDetailView,
  FinoI18n,
  FinoPortfolioShare,
  HISTORICAL_RATE_FALLBACKS,
  charts,
  convertCurrency,
  createRenderServices,
  document,
  escapeHtml,
  getAvailableQuantity,
  getDateString,
  loadData,
  markPaymentAsReceived,
  mobileApi,
  openBuyMoreModal,
  openEditAssetModal,
  openExpenseModal,
  openHoldingSelectionModal,
  openNoteModal,
  openSellAssetModal,
  renderAssetTransactionsModal,
  renderCalendar,
  renderDashboard,
  renderGoogleDriveStatus,
  renderPortfolio,
  renderProfitCalculator,
  renderRebalanceCalculator,
  renderTransactions,
  renderUpcomingPayments,
  renderWallet,
  setupBuyMoreModal,
  setupModal,
  setupNoteModal,
  setupSellModal,
  setupSettingsModal,
  setupWallet,
  showCalendarEvent,
  showNotice,
  stateStore,
  typeLabels,
  window,
}) {
// Stable interfaces for the incremental migration; legacy function names remain available.
const ui = {
  share: (() => {
    let controller;
    return { setup() {
      document.querySelector('#portfolio-share-button')?.addEventListener('click', () => {
        try {
          const feature = FinoPortfolioShare;
          if (!feature?.view || !feature.card || !feature.platform) throw new Error('Share module unavailable.');
          controller ||= feature.view.createController({ window, document, store: stateStore, feature, services: createRenderServices,
            getRates: () => ({ ...EXCHANGE_RATES }), getHistoricalRates: () => HISTORICAL_RATE_FALLBACKS,
            today: getDateString, i18n: FinoI18n, typeLabels, escapeHtml, nativeApi: mobileApi });
          controller.open();
        } catch (_) { void showNotice(FinoI18n.t('Portfolio share is unavailable.')); }
      });
    } };
  })(),
  asset: FinoAssetDetailView.createController({ store: stateStore, model: FinoAssetDetail, document, window, i18n: FinoI18n,
    typeLabels, escapeHtml, read: () => loadData(), getChart: () => charts.current, convert: (value, from, to) => convertCurrency(value, from, to),
    actions: { edit: ids => ids.length > 1 && ids.some(id => getAvailableQuantity(id) > 0) ? openHoldingSelectionModal(ids, 'edit') : openEditAssetModal(ids),
      buy: ids => openHoldingSelectionModal(ids, 'buy'), sell: ids => openSellAssetModal(ids),
      receive: (ids, button) => markPaymentAsReceived(ids, button) },
  }),
  dashboard: { render: renderDashboard, upcoming: renderUpcomingPayments },
  portfolio: { render: renderPortfolio, details: renderAssetTransactionsModal },
  transactions: { render: renderTransactions },
  calendar: { render: renderCalendar, showEvent: showCalendarEvent },
  wallet: { render: renderWallet },
  calculators: { render: renderProfitCalculator, rebalance: renderRebalanceCalculator },
  sync: { render: renderGoogleDriveStatus },
  forms: {
    asset: { setup: setupModal, edit: openEditAssetModal },
    buy: { setup: setupBuyMoreModal, open: openBuyMoreModal },
    sales: { setup: setupSellModal },
    wallet: { setup: setupWallet, expense: openExpenseModal },
    calendar: { setup: setupNoteModal, open: openNoteModal },
    settings: { setup: setupSettingsModal },
  },
};
return { ui };
}
