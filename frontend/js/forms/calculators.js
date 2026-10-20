(function () {
const state = stateStore.getState();
// forms/calculators.js
function setupProfitCalculator() {
  const calculateButton = document.querySelector("#calculate-profit");

  const allTimeButton = document.querySelector("#profit-all-time");

  if (calculateButton) {
    calculateButton.addEventListener("click", () => {
      renderProfitCalculator();
    });
  }

  if (allTimeButton) {
    allTimeButton.addEventListener("click", () => {
      const from = document.querySelector("#profit-from");

      const to = document.querySelector("#profit-to");

      if (from) {
        from.value = "";
      }

      if (to) {
        to.value = "";
      }

      renderProfitCalculator();
    });
  }

  /*
   * Automatically recalculate
   * when dates change.
   */

  const from = document.querySelector("#profit-from");

  const to = document.querySelector("#profit-to");
  const historyMode = document.querySelector("#portfolio-history-mode");
  const allocationMode = document.querySelector("#asset-allocation-mode");

  if (from) {
    from.addEventListener("change", () => renderProfitCalculator());
  }

  if (to) {
    to.addEventListener("change", () => renderProfitCalculator());
  }

  historyMode?.addEventListener("change", () => renderPortfolioHistoryChart());
  allocationMode?.addEventListener("change", () => renderAssetAllocationChart());
  document.querySelector('#concentration-basis')?.addEventListener('change', () => renderProfitCalculator());
  document.querySelector("#asset-price-history-select")?.addEventListener("change", () => renderAssetPriceHistoryChart());
  const priceFrom = document.querySelector("#asset-price-history-from");
  const priceTo = document.querySelector("#asset-price-history-to");
  [priceFrom, priceTo].forEach(input => input?.addEventListener("change", () => renderAssetPriceHistoryChart()));
  document.querySelector("#asset-price-history-all-time")?.addEventListener("click", () => {
    if (priceFrom) priceFrom.value = "";
    if (priceTo) priceTo.value = "";
    renderAssetPriceHistoryChart();
  });
}

function updateRebalanceTotal() {
  window.FinoRebalanceDashboard.update();
}

function calculateRebalance(event) {
  window.FinoRebalanceDashboard.calculate(event);
}

function setupRebalanceCalculator() {
  const form = document.querySelector("#rebalance-form");
  const modal = document.querySelector("#rebalance-asset-modal");
  const assetForm = document.querySelector("#rebalance-asset-form");
  const closeModal = () => {
    modal?.classList.remove("open");
    assetForm?.reset();
  };

  if (form) {
    form.addEventListener("submit", calculateRebalance);
  }
  document.querySelector('#normalize-rebalance')?.addEventListener('click', () => window.FinoRebalanceDashboard.normalize());

  document.querySelector("#add-rebalance-asset")?.addEventListener("click", () => {
    modal?.classList.add("open");
    requestAnimationFrame(() => assetForm?.elements.name.focus());
  });

  document.querySelector("#close-rebalance-asset-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-rebalance-asset")?.addEventListener("click", closeModal);
  assetForm?.elements.name.addEventListener('input', () => assetForm.elements.name.setCustomValidity(''));
  assetForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(new FormData(assetForm).get("name") || "").trim();
    if (!name) { assetForm.elements.name.setCustomValidity(window.FinoI18n.t('Asset name is required.')); assetForm.elements.name.reportValidity(); return; }
    state.rebalanceDrafts.push({ id: `planned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: name });
    closeModal();
    renderRebalanceCalculator();
    window.FinoRebalanceDashboard.changed();
  });
}
Object.assign(window, { setupProfitCalculator, updateRebalanceTotal, calculateRebalance, setupRebalanceCalculator });
})();
