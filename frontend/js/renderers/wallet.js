// renderers/wallet.js
function renderWalletCurrent(state = stateStore.getState()) {
  const { walletMonthKey, walletMonthView, walletCategories, walletCategoryTotal } = createRenderServices(state);
  const body = document.querySelector("#wallet-current-body");
  if (!body) return;
  const monthInput = document.querySelector("#wallet-current-month");
  if (monthInput) monthInput.value ||= walletMonthKey();
  const key = monthInput?.value || walletMonthKey();
  const month = walletMonthView(key);
  const categories = walletCategories(key);
  const expenseCategories = categories.filter((category) => category !== "Salary");
  const totalPlan = expenseCategories.reduce((sum, category) => sum + normalizeNumber(month.plans[category]), 0);
  const totalActual = expenseCategories.reduce((sum, category) => sum + walletCategoryTotal(key, category), 0);
  const spendingActual = totalActual - walletCategoryTotal(key, "Save+invest") - walletCategoryTotal(key, "Tithe");
  const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString(window.FinoI18n?.locale || "en", { month: "long", year: "numeric" });
  document.querySelector("#wallet-month-title").innerHTML = `${window.FinoI18n?.t("Budget") || "Budget"}<span>${escapeHtml(monthName)}</span>`;

  const row = category => FinoWalletView.budgetRow({
    category, plan: normalizeNumber(month.plans[category]), actual: walletCategoryTotal(key, category), totalPlan, totalActual,
    removable: month.customCategories.includes(category) && walletCategoryTotal(key, category) === 0,
    draft: state.walletPlanDrafts?.[walletActions.planDraftKey(key, category)],
  }, { money: walletMoney, escapeHtml, translate: window.FinoI18n.t });

  const remainder = totalPlan - totalActual;
  body.innerHTML = `<tr class="wallet-summary-row"><td>Budget<br>${escapeHtml(monthName)}</td><td>${walletMoney(totalPlan)}</td><td>100%</td><td>${walletMoney(totalActual)}</td><td class="wallet-balance ${remainder < 0 ? "negative-balance" : remainder > 0 ? "positive-balance" : ""}">${walletMoney(remainder)}</td><td>${totalPlan > 0 ? (totalActual / totalPlan * 100).toFixed(1) : "0.0"}%</td><td></td></tr>`
    + expenseCategories.map(row).join("")
    + `<tr class="wallet-summary-row wallet-budget-total"><td>Total</td><td>${walletMoney(totalPlan)}</td><td>100%</td><td>${walletMoney(totalActual)}</td><td class="wallet-balance ${remainder < 0 ? "negative-balance" : remainder > 0 ? "positive-balance" : ""}">${walletMoney(remainder)}</td><td>${totalPlan > 0 ? (totalActual / totalPlan * 100).toFixed(1) : "0.0"}%</td><td></td></tr>`
    + `<tr class="wallet-summary-row wallet-budget-spending"><td>Expenses for ${escapeHtml(monthName)}</td><td colspan="5">${walletMoney(spendingActual)}</td><td></td></tr>`;
  const labels = ['Expense category', 'Plan', 'Percentage', 'Actual amount', 'Balance', 'Actual percentage', 'Actions'];
  body.querySelectorAll('.wallet-summary-row').forEach(row => [...row.children].forEach((cell, index) => { cell.dataset.label = window.FinoI18n.t(labels[index]); }));

  renderBudgetProgress(totalActual, totalPlan);

  bindWalletPlanActions(body, key);

}

function renderBudgetProgress(spent, budget) {
  const card = document.querySelector("#budget-progress-card");
  if (!card) return;
  const percentage = budget > 0 ? spent / budget * 100 : 0;
  const fillPercentage = Math.min(Math.max(percentage, 0), 100);
  const remaining = budget - spent;
  document.querySelector("#budget-progress-values").textContent = `${walletMoney(spent)} / ${walletMoney(budget)}`;
  document.querySelector("#budget-progress-percent").textContent = `${percentage.toFixed(percentage >= 100 ? 0 : 1).replace(".0", "")}%`;
  document.querySelector("#budget-progress-remaining").textContent = `${walletMoney(remaining)} remaining`;
  const level = percentage > 100 ? "over" : percentage >= 80 ? "high" : percentage >= 60 ? "medium" : "low";
  card.dataset.level = level;
  const progress = card.querySelector(".wave-progress");
  const fill = document.querySelector("#budget-progress-fill");
  progress.setAttribute("aria-valuenow", String(Math.round(percentage)));
  progress.setAttribute("aria-valuetext", `${walletMoney(spent)} ${window.FinoI18n.t("of")} ${walletMoney(budget)} ${window.FinoI18n.t("spent")}; ${window.FinoI18n.t(`${walletMoney(remaining)} remaining`)}`);
  fill.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${fillPercentage}%`; }));
}

function renderWalletArchive(state = stateStore.getState()) {
  const { walletMonthKey, walletCategories, walletExpenses, walletCategoryTotal } = createRenderServices(state);
  const input = document.querySelector("#wallet-archive-month");
  const table = document.querySelector("#wallet-archive-table");
  if (!input || !table) return;
  input.value ||= walletMonthKey();
  const key = input.value;
  const categories = walletCategories(key);
  const expenses = walletExpenses(key);
  const days = [...new Set(expenses.map((expense) => expense.date))]
    .sort((a, b) => String(b).localeCompare(String(a)));
  const categoryTotals = categories.map((category) => walletCategoryTotal(key, category));
  table.innerHTML = `<thead><tr><th>Date</th>${categories.map((category) => `<th>${escapeHtml(category)}</th>`).join("")}<th>Total</th></tr></thead><tbody>`
    + (days.length ? days.map((date) => {
      const values = categories.map((category) => expenses.filter((item) => item.date === date && item.category === category).reduce((sum, item) => sum + normalizeNumber(item.amount), 0));
      const expenseTotal = values.reduce((sum, value, index) => sum + (categories[index] === "Salary" ? 0 : value), 0);
      return `<tr><td>${formatWalletDate(date)}</td>${values.map((value) => `<td>${value ? walletMoney(value) : "—"}</td>`).join("")}<td>${walletMoney(expenseTotal)}</td></tr>`;
    }).join("") : `<tr><td colspan="${categories.length + 2}" class="empty-state">No expenses for this month.</td></tr>`)
    + `</tbody><tfoot><tr class="wallet-summary-row"><th>Monthly total</th>${categoryTotals.map((value) => `<th>${walletMoney(value)}</th>`).join("")}<th>${walletMoney(categoryTotals.reduce((sum, value, index) => sum + (categories[index] === "Salary" ? 0 : value), 0))}</th></tr></tfoot>`;
}

function renderWalletExpenseList(state = stateStore.getState()) {
  const { walletMonthKey, walletExpenses } = createRenderServices(state);
  const body = document.querySelector("#wallet-expense-list");
  if (!body) return;
  const monthInput = document.querySelector("#wallet-expenses-month");
  if (monthInput) monthInput.value ||= walletMonthKey();
  const expenses = walletExpenses(monthInput?.value || walletMonthKey()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  body.innerHTML = expenses.length ? expenses.map((expense) => `<tr><td>${formatWalletDate(expense.date)}</td><td>${escapeHtml(expense.category)}</td><td>${walletMoney(expense.amount)}</td><td><span translate="no">${escapeHtml(expense.note || "—")}</span></td><td><div class="expense-row-actions"><button class="secondary-btn" data-edit-expense="${escapeHtml(expense.id)}">Edit</button><button class="icon-btn" data-delete-expense="${escapeHtml(expense.id)}" aria-label="Delete">×</button></div></td></tr>`).join("") : '<tr><td colspan="5" class="empty-state">No recorded expenses this month.</td></tr>';
  bindWalletExpenseActions(body);

}

function renderWalletNotes(state = stateStore.getState()) {
  const { walletMonthKey, walletMonthView } = createRenderServices(state);
  const list = document.querySelector("#wallet-notes-list");
  const description = document.querySelector("#wallet-notes-description");
  if (!list) return;
  const key = document.querySelector("#wallet-current-month")?.value || walletMonthKey();
  const month = walletMonthView(key);
  const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString(window.FinoI18n?.locale || "en", { month: "long", year: "numeric" });
  if (description) description.textContent = `Notes for ${monthName}`;
  list.innerHTML = month.notes.length
    ? month.notes.map((note) => `<div class="wallet-note"><span><span translate="no">${escapeHtml(note.text)}</span></span><button type="button" class="icon-btn" data-delete-wallet-note="${escapeHtml(note.id)}" aria-label="Delete note">×</button></div>`).join("")
    : "";
  bindWalletNoteActions(list, key);

}

function renderWallet(state = stateStore.getState()) {
  renderWalletCurrent(state);
  renderWalletArchive(state);
  renderWalletExpenseList(state);
  renderWalletNotes(state);
  if (document.querySelector("#wallet-charts")?.classList.contains("active")) renderWalletCharts(state);
  renderLoans(state);
}

function renderLoans(state = stateStore.getState()) {
  const { getLoanSchedule } = createRenderServices(state);
  const list = document.querySelector("#loans-list");
  const calendar = document.querySelector("#loan-calendar");
  if (!list || !calendar) return;
  list.innerHTML = stateStore.selectWallet(state).loans.length ? stateStore.selectWallet(state).loans.map((loan) => `<div class="loan-row"><div><strong><span translate="no">${escapeHtml(loan.name)}</span></strong><span><span translate="no">${escapeHtml(loan.institution || "—")}</span> · <span translate="no">${escapeHtml(loan.comment || "")}</span></span></div><div><span>Balance</span><strong>${walletMoney(loan.balance)}</strong></div><input type="number" min="0.01" step="0.01" value="${normalizeNumber(loan.monthlyPayment) || normalizeNumber(loan.balance)}" data-loan-payment="${escapeHtml(loan.id)}"><button class="primary-btn" data-repay-loan="${escapeHtml(loan.id)}" ${loan.status === "paid" ? "disabled" : ""}>${loan.status === "paid" ? "Paid" : "Repay"}</button><button class="secondary-btn" data-edit-loan="${escapeHtml(loan.id)}">Edit</button><button class="danger-btn" data-delete-loan="${escapeHtml(loan.id)}">Delete</button></div>`).join("") : '<p class="empty-state">No loans.</p>';
  bindLoanActions(list);
  const upcoming = stateStore.selectWallet(state).loans.flatMap((loan) => getLoanSchedule(loan)).filter((payment) => payment.date >= getDateString()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  calendar.innerHTML = upcoming.length ? upcoming.map((payment) => { const loan = stateStore.selectWallet(state).loans.find((item) => item.id === payment.loanId); return `<div class="loan-payment"><span>${formatWalletDate(payment.date)} · <span translate="no">${escapeHtml(loan?.name || "Loan")}</span></span><strong>${walletMoney(payment.amount)}</strong></div>`; }).join("") : '<p class="empty-state">No upcoming loan payments.</p>';
}
