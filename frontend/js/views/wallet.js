(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoWalletView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function budgetRow({ category, plan, actual, totalPlan, totalActual, removable }, { money, escapeHtml }) {
    const percent = totalPlan > 0 ? plan / totalPlan * 100 : 0;
    const actualPercent = totalActual > 0 ? actual / totalActual * 100 : 0;
    const balance = plan - actual;
    return `<tr><td>${escapeHtml(category)}</td><td><input type="number" min="0" step="0.01" enterkeyhint="done" value="${plan || ''}" data-wallet-plan="${escapeHtml(category)}" aria-label="Plan: ${escapeHtml(category)}"></td><td>${percent.toFixed(1)}%</td><td>${money(actual)}</td><td class="wallet-balance ${balance < 0 ? 'negative-balance' : balance > 0 ? 'positive-balance' : ''}">${money(balance)}</td><td>${actualPercent.toFixed(1)}%</td><td>${removable ? `<button class="icon-btn" data-remove-wallet-category="${escapeHtml(category)}">×</button>` : ''}</td></tr>`;
  }
  return { budgetRow };
});
