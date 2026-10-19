// Stable interfaces for the incremental migration; legacy function names remain available.
window.ui = {
  asset: FinoAssetDetailView.createController({ store: stateStore, model: FinoAssetDetail, document, window, i18n: FinoI18n,
    typeLabels, escapeHtml, read: () => loadData(), getChart: () => window.Chart, convert: (value, from, to) => convertCurrency(value, from, to),
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
