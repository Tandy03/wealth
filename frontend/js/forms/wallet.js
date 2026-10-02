// forms/wallet.js
function openExpenseModal(expenseId = null) {
  const modal = document.querySelector("#expense-modal");
  const form = document.querySelector("#expense-form");
  const expense = (state.data.wallet.expenses || []).find((item) => item.id === expenseId);
  state.editingExpenseId = expense?.id || null;
  form.reset();
  form.elements.date.value = expense?.date || getDateString();
  const key = String(form.elements.date.value).slice(0, 7);
  const categories = walletCategories(key);
  document.querySelector("#expense-category").innerHTML = categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("") + '<option value="__add_new__">Add new</option>';
  const groceries = categories.find((category) => category === "Groceries + household") || categories.find((category) => category.toLowerCase().startsWith("groceries"));
  form.elements.category.value = expense?.category || groceries || form.elements.category.value;
  form.elements.amount.value = expense?.amount || "";
  form.elements.note.value = expense?.note || "";
  document.querySelector("#expense-modal-title").textContent = expense ? "Edit expense" : "Record expense";
  document.querySelector("#new-category-field").hidden = true;
  document.querySelector("#new-expense-category").value = "";
  modal.classList.add("open");
}

function setupWallet() {
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
  document.querySelector("#wallet-archive-month")?.addEventListener("change", renderWalletArchive);
  document.querySelector("#wallet-current-month")?.addEventListener("change", () => { renderWalletCurrent(); renderWalletNotes(); });
  document.querySelector("#wallet-expenses-month")?.addEventListener("change", renderWalletExpenseList);
  document.querySelector("#wallet-chart-month")?.addEventListener("change", renderWalletCharts);
  document.querySelector("#wallet-monthly-category")?.addEventListener("change", renderWalletMonthlyChart);
  document.querySelector("#wallet-period-mode")?.addEventListener("change", renderWalletPeriodChart);
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
  document.querySelector("#wallet-note-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#wallet-note-text");
    const text = input.value.trim();
    if (!text) return;
    const key = document.querySelector("#wallet-current-month")?.value || walletMonthKey();
    walletMonth(key).notes.push({ id: `wallet-note-${Date.now()}`, text });
    await api.saveWallet(state.data.wallet);
    input.value = "";
    renderWalletNotes();
  });

  const modal = document.querySelector("#expense-modal");
  const form = document.querySelector("#expense-form");
  const close = () => { modal.classList.remove("open"); form.reset(); state.editingExpenseId = null; };
  document.querySelector("#add-expense-btn")?.addEventListener("click", () => openExpenseModal());
  document.querySelector("#close-expense-modal")?.addEventListener("click", close);
  document.querySelector("#cancel-expense")?.addEventListener("click", close);
  document.querySelector("#expense-category")?.addEventListener("change", (event) => {
    const adding = event.target.value === "__add_new__";
    document.querySelector("#new-category-field").hidden = !adding;
    if (adding) document.querySelector("#new-expense-category")?.focus();
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton?.disabled) return;
    const values = new FormData(form);
    const date = values.get("date");
    const key = String(date).slice(0, 7);
    let category = String(values.get("category") || "");
    if (category === "__add_new__") {
      category = document.querySelector("#new-expense-category").value.trim();
      if (!category) return showNotice("Enter a new category name.");
      if (!walletMonth(key).customCategories.includes(category)) walletMonth(key).customCategories.push(category);
    }
    const expense = { id: state.editingExpenseId || `expense-${Date.now()}`, date, category, amount: normalizeNumber(values.get("amount")), note: values.get("note") || "", currency: "UAH" };
    if (state.editingExpenseId) {
      const index = state.data.wallet.expenses.findIndex((item) => item.id === state.editingExpenseId);
      if (index >= 0) state.data.wallet.expenses[index] = { ...state.data.wallet.expenses[index], ...expense };
    } else {
      state.data.wallet.expenses.push(expense);
    }
    cleanupUnusedWalletCategories();
    if (submitButton) submitButton.disabled = true;
    try {
      await api.saveWallet(state.data.wallet);
      close();
      renderWallet();
    } catch (error) {
      console.error("Failed to save expense:", error);
      await showNotice(error?.message || "Failed to save wallet.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
