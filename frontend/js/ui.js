// Stable interfaces for the incremental migration; legacy function names remain available.
window.ui = {
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
