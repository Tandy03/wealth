// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createControllersActions({ FinoErrors, FinoWalletActions, api, console, showNotice, stateStore }) {
const state = stateStore.getState();
function runUiAction(action) {
  return Promise.resolve().then(action).catch(error => {
    console.error('UI action failed:', FinoErrors.diagnostics(error));
    void showNotice(error || 'Could not save your changes.');
  });
}
const walletActions = FinoWalletActions.createService({ store: stateStore, api });
return { runUiAction, walletActions };
}
