// Bootstrap and orchestration; public names remain compatible with existing forms.
async function loadData() {
  await refreshApplicationData();
  renderApplication();
  void updateSp500Benchmark();
}
async function init() {
  const controllers = [
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
  ];
  for (const [name, setup] of controllers) {
    try { initializeUiController(setup); }
    catch (error) { console.error(`${name} setup failed:`, error); }
  }
  try {
    await loadData();
    void api.getData({ sync: true }).then(() => loadData()).catch(error => console.warn('Background portfolio refresh failed:', error.message));
  } catch (error) {
    console.error('INITIALIZATION ERROR:', error);
    void showNotice(window.mobileApi ? (error.message || 'Could not load your local portfolio. Reconnect Google Drive or restore a backup.') : 'Could not connect to the local API. Start the server with npm run dev.');
  }
}
document.addEventListener('DOMContentLoaded', init);
