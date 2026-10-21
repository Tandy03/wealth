// The browser composition root is the only place that resolves legacy globals.
// The orchestration below can also run in Node with explicitly supplied services.
(function (root, createApplication) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createApplication };
    return;
  }
  const application = createApplication({
    store: stateStore, api, refreshData: refreshApplicationData, render: renderApplication,
    updateBenchmark: updateSp500Benchmark, initializeController: initializeUiController,
    diagnostics: root.FinoErrors.diagnostics, logger: root.console, showNotice,
    isNative: () => Boolean(root.mobileApi),
    controllers: [
      ['Notice modal', setupNoticeModal], ['Modal backdrop', setupModalBackdropClosing],
      ['Global errors', setupGlobalErrorHandling], ['Number inputs', disableNumberInputWheelChanges],
      ['Render subscriptions', setupRenderSubscriptions], ['Google Drive', setupGoogleDriveSync],
      ['Settings', setupSettingsModal], ['Responsive tables', setupResponsiveTables],
      ['Navigation', setupNavigation], ['Asset form', setupModal], ['Buy form', setupBuyMoreModal],
      ['Calendar', setupCalendarNavigation], ['Event modal', setupEventModal], ['Note form', setupNoteModal],
      ['Sale form', setupSellModal], ['Profit calculator', setupProfitCalculator],
      ['Portfolio sort', setupPortfolioSort], ['Rebalance', setupRebalanceCalculator],
      ['Market', setupMarket], ['Asset sync', setupInzhurSync], ['Theme', setupThemeToggle],
      ['Asset transactions', setupAssetTransactionsModal], ['Holding selection', setupDeleteHoldingModal],
      ['Wallet', setupWallet], ['Loans', setupLoans],
      ['Command recovery', setupCommandRecovery],
      ['Asset details', root.ui.asset.setup],
      ['Portfolio share', root.ui.share.setup],
    ],
  });
  // Existing forms keep these names until they migrate to ui.application.
  root.ui.application = application;
  Object.assign(root, { loadData: application.loadData, init: application.init });
  root.document.addEventListener('DOMContentLoaded', application.init);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApplication({
  store, api, refreshData, render, updateBenchmark, initializeController,
  controllers, diagnostics, logger, showNotice, isNative,
}) {
  async function loadData() {
    const result = await refreshData();
    if (!result.applied) return result;
    render();
    void updateBenchmark();
    return result;
  }
  async function init() {
    for (const [name, setup] of controllers) {
      try { initializeController(setup); }
      catch (error) { logger.error(`${name} setup failed:`, diagnostics(error)); }
    }
    try {
      await loadData();
      const context = store.capture();
      void api.getData({ sync: true }).then(() => {
        if (store.isCurrent(context)) return loadData();
      }).catch(error => {
        if (store.isCurrent(context)) logger.warn('Background portfolio refresh failed:', diagnostics(error));
      });
    } catch (error) {
      logger.error('INITIALIZATION ERROR:', diagnostics(error));
      void showNotice(error?.requestId ? error : isNative()
        ? (error || 'Could not load your local portfolio. Reconnect Google Drive or restore a backup.')
        : 'Could not connect to the local API. Start the server with npm run dev.');
    }
  }
  return { loadData, init };
});
