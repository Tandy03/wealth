(function () {
const state = stateStore.getState();
// Page event controllers; renderers never call transport directly.

function bindRebalanceActions(targets) {
  targets.querySelectorAll("[data-rebalance-group]").forEach((input) => {
    input.addEventListener("input", updateRebalanceTotal);
  });

  targets.querySelectorAll("[data-remove-rebalance]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeRebalance;
      if (!id.startsWith("planned-") && !state.rebalanceExcluded.includes(id)) {
        state.rebalanceExcluded.push(id);
      }
      state.rebalanceDrafts = state.rebalanceDrafts.filter((item) => item.id !== id);
      button.closest(".rebalance-field")?.remove();
      updateRebalanceTotal();
    });
  });

}
Object.assign(window, { bindRebalanceActions });
})();
