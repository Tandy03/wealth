// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createFormsCalculators({
  FinoI18n,
  FinoRebalanceDashboard,
  FormData,
  document,
  renderAssetAllocationChart,
  renderAssetPriceHistoryChart,
  renderPortfolioHistoryChart,
  renderProfitCalculator,
  renderRebalanceCalculator,
  requestAnimationFrame,
  stateStore,
}) {
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
  const priceAppearance = document.querySelector('#asset-price-history-appearance');
  priceAppearance?.addEventListener('click', event => {
    const button = event.target.closest('[data-price-chart-style]');
    if (!button || button.getAttribute('aria-pressed') === 'true' || !['real', 'smooth'].includes(button.dataset.priceChartStyle)) return;
    priceAppearance.querySelectorAll('[data-price-chart-style]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderAssetPriceHistoryChart(stateStore.getState(), true);
  });
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
  FinoRebalanceDashboard.update();
}

function calculateRebalance(event) {
  FinoRebalanceDashboard.calculate(event);
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
  document.querySelector('#normalize-rebalance')?.addEventListener('click', () => FinoRebalanceDashboard.normalize());

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
    if (!name) { assetForm.elements.name.setCustomValidity(FinoI18n.t('Asset name is required.')); assetForm.elements.name.reportValidity(); return; }
    stateStore.setUI({ rebalanceDrafts: [...stateStore.selectUI('rebalanceDrafts'), { id: `planned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: name }] });
    closeModal();
    renderRebalanceCalculator();
    FinoRebalanceDashboard.changed();
  });
}
return { calculateRebalance, setupProfitCalculator, setupRebalanceCalculator, updateRebalanceTotal };
}
