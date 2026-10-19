(function () {
const state = stateStore.getState();
// forms/wallet.js
function openExpenseModal(expenseId = null) {
  const modal = document.querySelector("#expense-modal");
  const form = document.querySelector("#expense-form");
  const expense = (state.data.wallet.expenses || []).find((item) => item.id === expenseId);
  stateStore.setUI({ editingExpenseId: expense?.id || null });
  form.reset();
  form.elements.date.value = expense?.date || getDateString();
  const key = String(form.elements.date.value).slice(0, 7);
  const categories = walletCategories(key);
  document.querySelector("#expense-category").innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("") + '<option value="__add_new__">Add new</option>';
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
  setupWalletNavigation();
  document.querySelector("#wallet-note-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#wallet-note-text");
    const text = input.value.trim();
    if (!text) return;
    const key = document.querySelector("#wallet-current-month")?.value || walletMonthKey();
    if (input.disabled) return;
    input.disabled = true;
    try { await walletActions.mutate(wallet => FinoWalletActions.month(wallet, key).notes.push({ id: `wallet-note-${Date.now()}`, text })); }
    catch (error) { void showNotice(error || 'Failed to save wallet.'); return; }
    finally { input.disabled = false; }
    if (input.value.trim() === text) input.value = "";
    renderWalletNotes();
  });

  const modal = document.querySelector("#expense-modal");
  const form = document.querySelector("#expense-form");
  const close = () => { modal.classList.remove("open"); form.reset(); stateStore.setUI({ editingExpenseId: null }); };
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
    }
    const expense = { id: state.editingExpenseId || `expense-${Date.now()}`, date, category, amount: normalizeNumber(values.get("amount")), note: values.get("note") || "", currency: "UAH" };
    const editingId = state.editingExpenseId;
    if (submitButton) submitButton.disabled = true;
    try {
      await walletActions.mutate(wallet => {
        if (String(values.get('category')) === '__add_new__') {
          const month = FinoWalletActions.month(wallet, key);
          if (!month.customCategories.includes(category)) month.customCategories.push(category);
        }
        if (editingId) {
          const index = wallet.expenses.findIndex(item => item.id === editingId);
          if (index < 0) throw new window.FinoErrors.ConflictError({ message: 'This expense changed. Reload before editing it again.' });
          wallet.expenses[index] = { ...wallet.expenses[index], ...expense };
        } else wallet.expenses.push(expense);
        FinoWalletActions.cleanupCategories(wallet);
      });
      close();
      renderWallet();
    } catch (error) {
      console.error("Failed to save expense:", window.FinoErrors.diagnostics(error));
      await showNotice(error || "Failed to save wallet.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
Object.assign(window, { openExpenseModal, setupWallet });
})();
