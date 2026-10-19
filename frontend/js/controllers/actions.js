(function () {
const state = stateStore.getState();
function runUiAction(action) {
  return Promise.resolve().then(action).catch(error => {
    console.error('UI action failed:', window.FinoErrors.diagnostics(error));
    void showNotice(error || 'Could not save your changes.');
  });
}
const walletActions = FinoWalletActions.createService({ store: stateStore, api });
Object.assign(window, { runUiAction, walletActions });
})();
