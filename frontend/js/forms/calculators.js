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
  document.querySelector("#asset-price-history-select")?.addEventListener("change", () => renderAssetPriceHistoryChart());
}

function updateRebalanceTotal() {
  const total = [...document.querySelectorAll("[data-rebalance-group]")].reduce(
    (sum, input) => sum + normalizeNumber(input.value),
    0,
  );
  const element = document.querySelector("#rebalance-total");

  if (element) {
    element.textContent = `${total.toFixed(1)}%`;
    element.classList.toggle("invalid", Math.abs(total - 100) > 0.01);
  }
}

function calculateRebalance(event) {
  event.preventDefault();

  const result = document.querySelector("#rebalance-results");
  const inputs = [...document.querySelectorAll("[data-rebalance-group]")];

  if (!result || !inputs.length) {
    return;
  }

  const targets = inputs.map((input) => ({
    groupId: input.dataset.rebalanceGroup,
    percent: normalizeNumber(input.value),
  }));
  let plan;
  try {
    plan = calculateRebalancePlan(targets);
  } catch (error) {
    result.innerHTML = `<p class="rebalance-message">${escapeHtml(error.message)}</p>`;
    return;
  }
  const { recommendations, totalToInvest } = plan;

  result.innerHTML = recommendations
    .map((item) => {
      const difference = item.difference;
      const action = difference > 0.005 ? `Buy ${money(difference)}` : "No purchase";
      return `<div class="rebalance-result"><span>${escapeHtml(item.group?.label || "Asset")}</span><strong>${action}</strong></div>`;
    })
    .join("") + `<div class="rebalance-result rebalance-result-total"><span>Total to invest</span><strong>${money(totalToInvest)}</strong></div>`;
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

  document.querySelector("#add-rebalance-asset")?.addEventListener("click", () => {
    modal?.classList.add("open");
    requestAnimationFrame(() => assetForm?.elements.name.focus());
  });

  document.querySelector("#close-rebalance-asset-modal")?.addEventListener("click", closeModal);
  document.querySelector("#cancel-rebalance-asset")?.addEventListener("click", closeModal);
  assetForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(new FormData(assetForm).get("name") || "").trim();
    if (!name) return;
    state.rebalanceDrafts.push({ id: `planned-${Date.now()}`, label: name });
    closeModal();
    renderRebalanceCalculator();
  });
}
Object.assign(window, { setupProfitCalculator, updateRebalanceTotal, calculateRebalance, setupRebalanceCalculator });
})();
