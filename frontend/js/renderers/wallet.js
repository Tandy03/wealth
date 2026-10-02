// renderers/wallet.js
function renderWalletCurrent() {
  const body = document.querySelector("#wallet-current-body");
  if (!body) return;
  const monthInput = document.querySelector("#wallet-current-month");
  if (monthInput) monthInput.value ||= walletMonthKey();
  const key = monthInput?.value || walletMonthKey();
  const month = walletMonth(key);
  const categories = walletCategories(key);
  const expenseCategories = categories.filter((category) => category !== "Salary");
  const totalPlan = expenseCategories.reduce((sum, category) => sum + normalizeNumber(month.plans[category]), 0);
  const totalActual = expenseCategories.reduce((sum, category) => sum + walletCategoryTotal(key, category), 0);
  const spendingActual = totalActual - walletCategoryTotal(key, "Save+invest") - walletCategoryTotal(key, "Tithe");
  const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString(window.FinoI18n?.locale || "en", { month: "long", year: "numeric" });
  document.querySelector("#wallet-month-title").innerHTML = `${window.FinoI18n?.t("Budget") || "Budget"}<span>${escapeHtml(monthName)}</span>`;

  const row = (category) => {
    const plan = normalizeNumber(month.plans[category]);
    const actual = walletCategoryTotal(key, category);
    const percent = totalPlan > 0 ? plan / totalPlan * 100 : 0;
    const actualPercent = totalActual > 0 ? actual / totalActual * 100 : 0;
    const balance = plan - actual;
    return `<tr><td>${escapeHtml(category)}</td><td><input type="number" min="0" step="0.01" enterkeyhint="done" value="${plan || ""}" data-wallet-plan="${escapeHtml(category)}" aria-label="Plan: ${escapeHtml(category)}"></td><td>${percent.toFixed(1)}%</td><td>${walletMoney(actual)}</td><td class="wallet-balance ${balance < 0 ? "negative-balance" : balance > 0 ? "positive-balance" : ""}">${walletMoney(balance)}</td><td>${actualPercent.toFixed(1)}%</td><td>${month.customCategories.includes(category) && actual === 0 ? `<button class="icon-btn" data-remove-wallet-category="${escapeHtml(category)}">×</button>` : ""}</td></tr>`;
  };

  const remainder = totalPlan - totalActual;
  body.innerHTML = `<tr class="wallet-summary-row"><td>Budget<br>${escapeHtml(monthName)}</td><td>${walletMoney(totalPlan)}</td><td>100%</td><td>${walletMoney(totalActual)}</td><td class="wallet-balance ${remainder < 0 ? "negative-balance" : remainder > 0 ? "positive-balance" : ""}">${walletMoney(remainder)}</td><td>${totalPlan > 0 ? (totalActual / totalPlan * 100).toFixed(1) : "0.0"}%</td><td></td></tr>`
    + expenseCategories.map(row).join("")
    + `<tr class="wallet-summary-row"><td>Total</td><td>${walletMoney(totalPlan)}</td><td>100%</td><td>${walletMoney(totalActual)}</td><td class="wallet-balance ${remainder < 0 ? "negative-balance" : remainder > 0 ? "positive-balance" : ""}">${walletMoney(remainder)}</td><td>${totalPlan > 0 ? (totalActual / totalPlan * 100).toFixed(1) : "0.0"}%</td><td></td></tr>`
    + `<tr class="wallet-summary-row"><td>Expenses for ${escapeHtml(monthName)}</td><td colspan="5">${walletMoney(spendingActual)}</td><td></td></tr>`;

  renderBudgetProgress(totalActual, totalPlan);

  body.querySelectorAll("[data-wallet-plan]").forEach((input) => input.addEventListener("change", async () => {
    month.plans[input.dataset.walletPlan] = normalizeNumber(input.value);
    await api.saveWallet(state.data.wallet);
    renderWalletCurrent();
  }));
  body.querySelectorAll("[data-wallet-plan]").forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  }));
  body.querySelectorAll("[data-remove-wallet-category]").forEach((button) => button.addEventListener("click", async () => {
    month.customCategories = month.customCategories.filter((name) => name !== button.dataset.removeWalletCategory);
    delete month.plans[button.dataset.removeWalletCategory];
    await api.saveWallet(state.data.wallet);
    renderWallet();
  }));
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
  progress.setAttribute("aria-valuetext", `${walletMoney(spent)} of ${walletMoney(budget)} spent; ${walletMoney(remaining)} remaining`);
  fill.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${fillPercentage}%`; }));
}

function renderWalletArchive() {
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

function renderWalletExpenseList() {
  const body = document.querySelector("#wallet-expense-list");
  if (!body) return;
  const monthInput = document.querySelector("#wallet-expenses-month");
  if (monthInput) monthInput.value ||= walletMonthKey();
  const expenses = walletExpenses(monthInput?.value || walletMonthKey()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  body.innerHTML = expenses.length ? expenses.map((expense) => `<tr><td>${formatWalletDate(expense.date)}</td><td>${escapeHtml(expense.category)}</td><td>${walletMoney(expense.amount)}</td><td>${escapeHtml(expense.note || "—")}</td><td><div class="expense-row-actions"><button class="secondary-btn" data-edit-expense="${escapeHtml(expense.id)}">Edit</button><button class="icon-btn" data-delete-expense="${escapeHtml(expense.id)}" aria-label="Delete">×</button></div></td></tr>`).join("") : '<tr><td colspan="5" class="empty-state">No recorded expenses this month.</td></tr>';
  body.querySelectorAll("[data-edit-expense]").forEach((button) => button.addEventListener("click", () => openExpenseModal(button.dataset.editExpense)));
  body.querySelectorAll("[data-delete-expense]").forEach((button) => button.addEventListener("click", async () => {
    if (!(await showConfirm("Delete this expense?"))) return;
    state.data.wallet.expenses = state.data.wallet.expenses.filter((expense) => expense.id !== button.dataset.deleteExpense);
    cleanupUnusedWalletCategories();
    await api.saveWallet(state.data.wallet);
    renderWallet();
  }));
}

function renderWalletNotes() {
  const list = document.querySelector("#wallet-notes-list");
  const description = document.querySelector("#wallet-notes-description");
  if (!list) return;
  const key = document.querySelector("#wallet-current-month")?.value || walletMonthKey();
  const month = walletMonth(key);
  const monthName = new Date(`${key}-01T00:00:00`).toLocaleDateString(window.FinoI18n?.locale || "en", { month: "long", year: "numeric" });
  if (description) description.textContent = `Notes for ${monthName}`;
  list.innerHTML = month.notes.length
    ? month.notes.map((note) => `<div class="wallet-note"><span>${escapeHtml(note.text)}</span><button type="button" class="icon-btn" data-delete-wallet-note="${escapeHtml(note.id)}" aria-label="Delete note">×</button></div>`).join("")
    : "";
  list.querySelectorAll("[data-delete-wallet-note]").forEach((button) => button.addEventListener("click", async () => {
    month.notes = month.notes.filter((note) => note.id !== button.dataset.deleteWalletNote);
    await api.saveWallet(state.data.wallet);
    renderWalletNotes();
  }));
}

function renderWallet() {
  if (!state.data.wallet) state.data.wallet = { expenses: [], months: {} };
  renderWalletCurrent();
  renderWalletArchive();
  renderWalletExpenseList();
  renderWalletNotes();
  if (document.querySelector("#wallet-charts")?.classList.contains("active")) renderWalletCharts();
  renderLoans();
}

function renderLoans() {
  const list = document.querySelector("#loans-list");
  const calendar = document.querySelector("#loan-calendar");
  if (!list || !calendar) return;
  state.data.wallet.loans ||= [];
  list.innerHTML = state.data.wallet.loans.length ? state.data.wallet.loans.map((loan) => `<div class="loan-row"><div><strong>${escapeHtml(loan.name)}</strong><span>${escapeHtml(loan.institution || "—")} · ${escapeHtml(loan.comment || "")}</span></div><div><span>Balance</span><strong>${walletMoney(loan.balance)}</strong></div><input type="number" min="0.01" step="0.01" value="${normalizeNumber(loan.monthlyPayment) || normalizeNumber(loan.balance)}" data-loan-payment="${escapeHtml(loan.id)}"><button class="primary-btn" data-repay-loan="${escapeHtml(loan.id)}" ${loan.status === "paid" ? "disabled" : ""}>${loan.status === "paid" ? "Paid" : "Repay"}</button><button class="secondary-btn" data-edit-loan="${escapeHtml(loan.id)}">Edit</button><button class="danger-btn" data-delete-loan="${escapeHtml(loan.id)}">Delete</button></div>`).join("") : '<p class="empty-state">No loans.</p>';
  list.querySelectorAll("[data-repay-loan]").forEach((button) => button.addEventListener("click", async () => {
    const loan = state.data.wallet.loans.find((item) => item.id === button.dataset.repayLoan);
    const amount = normalizeNumber(list.querySelector(`[data-loan-payment="${loan?.id}"]`)?.value);
    if (!loan || amount <= 0) return showNotice("Enter a valid repayment amount.", "Loan repayment");
    loan.balance = Math.max(0, normalizeNumber(loan.balance) - amount);
    loan.repayments ||= [];
    loan.repayments.push({ id: `repayment-${Date.now()}`, date: getDateString(), amount });
    if (loan.method === "manual") {
      const scheduled = (loan.manualSchedule || []).filter((payment) => !payment.paid).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (scheduled) {
        if (amount >= normalizeNumber(scheduled.amount)) scheduled.paid = true;
        else scheduled.amount = normalizeNumber(scheduled.amount) - amount;
      }
    }
    if (loan.balance === 0) loan.status = "paid";
    await api.saveWallet(state.data.wallet);
    renderLoans();
  }));
  list.querySelectorAll("[data-edit-loan]").forEach((button) => button.addEventListener("click", () => openLoanModal(button.dataset.editLoan)));
  list.querySelectorAll("[data-delete-loan]").forEach((button) => button.addEventListener("click", async () => {
    if (!(await showConfirm("Delete this loan and its repayment history?", "Delete loan"))) return;
    state.data.wallet.loans = state.data.wallet.loans.filter((loan) => loan.id !== button.dataset.deleteLoan);
    await api.saveWallet(state.data.wallet);
    renderLoans();
  }));
  const upcoming = state.data.wallet.loans.flatMap((loan) => getLoanSchedule(loan)).filter((payment) => payment.date >= getDateString()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  calendar.innerHTML = upcoming.length ? upcoming.map((payment) => { const loan = state.data.wallet.loans.find((item) => item.id === payment.loanId); return `<div class="loan-payment"><span>${formatWalletDate(payment.date)} · ${escapeHtml(loan?.name || "Loan")}</span><strong>${walletMoney(payment.amount)}</strong></div>`; }).join("") : '<p class="empty-state">No upcoming loan payments.</p>';
}
