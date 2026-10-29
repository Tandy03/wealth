// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createControllersCalculators({ FinoRebalanceDashboard, stateStore }) {
const state = stateStore.getState();
// Page event controllers; renderers never call transport directly.

function bindRebalanceActions(targets) {
  FinoRebalanceDashboard.bind(targets);
}
return { bindRebalanceActions };
}
