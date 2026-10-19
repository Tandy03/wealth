(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoWalletView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function budgetRow({ category, plan, actual, totalPlan, totalActual, removable, draft }, { money, escapeHtml, translate = value => value }) {
    const percent = totalPlan > 0 ? plan / totalPlan * 100 : 0;
    const actualPercent = totalActual > 0 ? actual / totalActual * 100 : 0;
    const balance = plan - actual;
    const label = text => escapeHtml(translate(text));
    return `<tr class="wallet-category-row${removable ? ' has-remove-category' : ''}"><td class="wallet-category-title">${escapeHtml(category)}</td><td data-label="${label('Plan')}" class="wallet-plan-cell"><input type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="done" value="${escapeHtml(draft ? draft.value : plan || '')}" data-wallet-plan="${escapeHtml(category)}" aria-label="${label('Plan')}: ${escapeHtml(category)}" ${draft?.status === 'pending' ? 'disabled' : ''} ${draft?.status === 'error' ? 'aria-invalid="true"' : ''}></td><td>${percent.toFixed(1)}%</td><td data-label="${label('Actual amount')}">${money(actual)}</td><td data-label="${label('Balance')}" class="wallet-balance ${balance < 0 ? 'negative-balance' : balance > 0 ? 'positive-balance' : ''}">${money(balance)}</td><td>${actualPercent.toFixed(1)}%</td><td class="wallet-category-actions">${removable ? `<button class="icon-btn" data-remove-wallet-category="${escapeHtml(category)}" aria-label="${label('Delete')}: ${escapeHtml(category)}">×</button>` : ''}</td></tr>`;
  }
  return { budgetRow };
});
