(function () {
const state = stateStore.getState();
// Wallet mutations are committed through actions after a successful save.
function bindWalletPlanActions(body, key) {
  body.querySelectorAll('[data-wallet-plan]').forEach(input => {
    input.addEventListener('change', () => runUiAction(async () => {
      input.disabled = true;
      try {
        await walletActions.mutate(wallet => { FinoWalletActions.month(wallet, key).plans[input.dataset.walletPlan] = normalizeNumber(input.value); });
      } finally {
        renderWalletCurrent();
      }
    }));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
  });
  body.querySelectorAll('[data-remove-wallet-category]').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    await walletActions.mutate(wallet => {
      const month = FinoWalletActions.month(wallet, key);
      month.customCategories = month.customCategories.filter(name => name !== button.dataset.removeWalletCategory);
      delete month.plans[button.dataset.removeWalletCategory];
    });
    renderWallet();
  })));
}
function bindWalletExpenseActions(body) {
  body.querySelectorAll('[data-edit-expense]').forEach(button => button.addEventListener('click', () => openExpenseModal(button.dataset.editExpense)));
  body.querySelectorAll('[data-delete-expense]').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    if (!(await showConfirm('Delete this expense?'))) return;
    await walletActions.mutate(wallet => {
      wallet.expenses = wallet.expenses.filter(expense => expense.id !== button.dataset.deleteExpense);
      createRenderServices({ ...stateStore.getState(), data: { ...stateStore.getData(), wallet } }).cleanupUnusedWalletCategories();
    });
    renderWallet();
  })));
}
function bindWalletNoteActions(list, key) {
  list.querySelectorAll('[data-delete-wallet-note]').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    await walletActions.mutate(wallet => {
      const month = FinoWalletActions.month(wallet, key);
      month.notes = month.notes.filter(note => note.id !== button.dataset.deleteWalletNote);
    });
    renderWalletNotes();
  })));
}
function bindLoanActions(list) {
  list.querySelectorAll('[data-repay-loan]').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    const id = button.dataset.repayLoan;
    const amount = normalizeNumber(list.querySelector(`[data-loan-payment="${id}"]`)?.value);
    if (amount <= 0) return showNotice('Enter a valid repayment amount.', 'Loan repayment');
    await walletActions.mutate(wallet => {
      const loan = wallet.loans.find(item => item.id === id);
      if (!loan) throw new Error('Loan not found.');
      loan.balance = Math.max(0, normalizeNumber(loan.balance) - amount);
      loan.repayments ||= [];
      loan.repayments.push({ id: `repayment-${Date.now()}`, date: getDateString(), amount });
      if (loan.method === 'manual') {
        const scheduled = (loan.manualSchedule || []).filter(payment => !payment.paid).sort((a, b) => a.date.localeCompare(b.date))[0];
        if (scheduled) {
          if (amount >= normalizeNumber(scheduled.amount)) scheduled.paid = true;
          else scheduled.amount = normalizeNumber(scheduled.amount) - amount;
        }
      }
      if (loan.balance === 0) loan.status = 'paid';
    });
    renderLoans();
  })));
  list.querySelectorAll('[data-edit-loan]').forEach(button => button.addEventListener('click', () => openLoanModal(button.dataset.editLoan)));
  list.querySelectorAll('[data-delete-loan]').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    if (!(await showConfirm('Delete this loan and its repayment history?', 'Delete loan'))) return;
    await walletActions.mutate(wallet => { wallet.loans = wallet.loans.filter(loan => loan.id !== button.dataset.deleteLoan); });
    renderLoans();
  })));
}

function setupWalletNavigation() {
  const investments = document.querySelector("#investments-app");
  const walletApp = document.querySelector("#wallet-app");
  investments.hidden = true;
  walletApp.hidden = false;
  document.querySelector("#open-wallet")?.addEventListener("click", () => {
    investments.hidden = true;
    walletApp.hidden = false;
    document.querySelectorAll(".wallet-tab").forEach((item) => item.classList.toggle("active", item.dataset.walletTab === "current"));
    document.querySelectorAll(".wallet-page").forEach((page) => page.classList.toggle("active", page.id === "wallet-current"));
    renderWallet();
  });
  document.querySelector("#open-investments")?.addEventListener("click", () => {
    walletApp.hidden = true;
    investments.hidden = false;
    document.querySelectorAll("#investments-app .nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === "dashboard"));
    document.querySelectorAll("#investments-app .page-section").forEach((page) => page.classList.toggle("active", page.id === "dashboard-section"));
    const title = document.querySelector("#page-title");
    if (title) title.textContent = "Dashboard";
    renderDashboard();
  });
  document.querySelectorAll(".wallet-tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".wallet-tab").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".wallet-page").forEach((page) => page.classList.toggle("active", page.id === `wallet-${button.dataset.walletTab}`));
    if (button.dataset.walletTab === "archive") renderWalletArchive();
    if (button.dataset.walletTab === "charts") renderWalletCharts();
  }));
  document.querySelector("#wallet-archive-month")?.addEventListener("change", () => renderWalletArchive());
  document.querySelector("#wallet-current-month")?.addEventListener("change", () => { renderWalletCurrent(); renderWalletNotes(); });
  document.querySelector("#wallet-expenses-month")?.addEventListener("change", () => renderWalletExpenseList());
  document.querySelector("#wallet-chart-month")?.addEventListener("change", () => renderWalletCharts());
  document.querySelector("#wallet-monthly-category")?.addEventListener("change", () => renderWalletMonthlyChart());
  document.querySelector("#wallet-period-mode")?.addEventListener("change", () => renderWalletPeriodChart());
  document.querySelector("#wallet-period-preset")?.addEventListener("change", () => {
    applyWalletPeriodPreset();
    renderWalletPeriodChart();
  });
  ["#wallet-period-from", "#wallet-period-to"].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => {
      const preset = document.querySelector("#wallet-period-preset");
      if (preset) preset.value = "custom";
      renderWalletPeriodChart();
    });
  });

}
Object.assign(window, { bindWalletPlanActions, bindWalletExpenseActions, bindWalletNoteActions, bindLoanActions, setupWalletNavigation });
})();
