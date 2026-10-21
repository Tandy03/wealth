// Stable interfaces for the incremental migration; legacy function names remain available.
window.ui = {
  share: (() => {
    let controller;
    return { setup() {
      document.querySelector('#portfolio-share-button')?.addEventListener('click', () => {
        try {
          const feature = window.FinoPortfolioShare;
          if (!feature?.view || !feature.card || !feature.platform) throw new Error('Share module unavailable.');
          controller ||= feature.view.createController({ window, document, store: stateStore, feature, services: createRenderServices,
            getRates: () => ({ ...EXCHANGE_RATES }), getHistoricalRates: () => HISTORICAL_RATE_FALLBACKS,
            today: getDateString, i18n: FinoI18n, typeLabels, escapeHtml });
          controller.open();
        } catch (_) { void showNotice(FinoI18n.t('Portfolio share is unavailable.')); }
      });
    } };
  })(),
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
