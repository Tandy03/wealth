// renderers/calculators.js
function renderProfitCalculator() {
  renderAssetAllocationChart();
  renderPortfolioHistoryChart();
  renderAssetPriceHistoryChart();

  const from = document.querySelector("#profit-from")?.value || null;

  const to = document.querySelector("#profit-to")?.value || null;

  const result = calculateProfit(from, to);

  /*
   * Support both old and
   * potential new selectors.
   */

  const dividendsElement = document.querySelector("#profit-dividends");

  const couponsElement = document.querySelector("#profit-coupons");

  const maturityElement = document.querySelector("#profit-maturity");

  const salesElement = document.querySelector("#profit-sales");

  const priceGrowthElement = document.querySelector("#profit-price-growth");

  const totalElement = document.querySelector("#profit-total");

  const roiElement = document.querySelector("#profit-roi");

  if (dividendsElement) {
    dividendsElement.textContent = money(result.dividends);
  }

  if (couponsElement) {
    couponsElement.textContent = money(result.coupons);
  }

  if (maturityElement) {
    maturityElement.textContent = money(result.maturity);
  }

  if (salesElement) {
    salesElement.textContent = money(result.salesProfit);
  }

  if (priceGrowthElement) {
    priceGrowthElement.textContent = money(result.priceGrowth);
  }

  if (totalElement) {
    totalElement.textContent = money(result.totalProfit);
  }

  if (roiElement) {
    roiElement.textContent = `${result.roi.toFixed(2)}%`;
  }

  /*
   * Per-asset table
   */

  const renderProfitTable = (tbody, rows) => {
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    class="empty-state"
                >
                    No profit data for selected period.
                </td>
            </tr>
        `;
      return;
    }

    tbody.innerHTML = rows
      .map((asset) => {
      return `
                        <tr>

                            <td>
                                <strong>
                                    ${escapeHtml(asset.label)}
                                </strong>
                            </td>

                            <td>
                                ${money(asset.invested, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.dividends, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.coupons, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.maturity, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.salesProfit, asset.currency)}
                            </td>

                            <td>
                                ${money(asset.priceGrowth, asset.currency)}
                            </td>

                            <td>
                                <strong>
                                    ${money(asset.totalProfit, asset.currency)}
                                </strong>
                            </td>

                            <td>
                                ${asset.roi.toFixed(2)}%
                            </td>

                        </tr>
                    `;
      })
      .join("");
  };

  const { assetRows, typeRows } = summarizeProfit(result, typeLabels);
  renderProfitTable(document.querySelector("#profit-assets-table"), assetRows);
  renderProfitTable(document.querySelector("#profit-types-table"), typeRows);
}

function renderRebalanceCalculator() {
  const targets = document.querySelector("#rebalance-targets");

  if (!targets) {
    return;
  }

  const groups = getRebalanceGroups().filter(group => !state.rebalanceExcluded.includes(group.id));

  if (!groups.length) {
    targets.innerHTML = '<p class="rebalance-empty">Add an asset to calculate a rebalance.</p>';
    const total = document.querySelector("#rebalance-total");
    const results = document.querySelector("#rebalance-results");

    if (total) {
      total.textContent = "0%";
    }

    if (results) {
      results.innerHTML = "";
    }

    return;
  }

  targets.innerHTML = groups
    .map((group) => `
      <label class="rebalance-field">
        <span title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
        <input type="number" min="0" max="100" step="0.1" value="0" data-rebalance-group="${escapeHtml(group.id)}" aria-label="Target share for ${escapeHtml(group.label)}" />
        <button type="button" class="icon-btn" data-remove-rebalance="${escapeHtml(group.id)}" aria-label="Remove ${escapeHtml(group.label)}">×</button>
      </label>
    `)
    .join("");

  const results = document.querySelector("#rebalance-results");

  if (results) {
    results.innerHTML = "";
  }

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

  updateRebalanceTotal();
}
