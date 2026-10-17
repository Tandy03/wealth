(function () {
const state = stateStore.getState();
// Page event controllers; renderers never call transport directly.

function bindRebalanceActions(targets) {
  window.FinoRebalanceDashboard.bind(targets);
}
Object.assign(window, { bindRebalanceActions });
})();
