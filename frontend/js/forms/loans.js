(function () {
const state = stateStore.getState();
// forms/loans.js
function updateLoanMethodFields() {
  const method = document.querySelector("#loan-method")?.value;
  ["#loan-monthly-payment-field", "#loan-payment-day-field", "#loan-last-payment-field"].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.hidden = method !== "monthly";
  });
  const manual = document.querySelector("#loan-manual-schedule-field");
  if (manual) manual.hidden = method !== "manual";
  const form = document.querySelector("#loan-form");
  if (form) {
    form.elements.monthlyPayment.required = method === "monthly";
    form.elements.paymentDay.required = method === "monthly";
    form.elements.lastPaymentDate.required = method === "monthly";
    form.elements.manualSchedule.required = method === "manual";
  }
}

function openLoanModal(loanId = null) {
  const modal = document.querySelector("#loan-modal");
  const form = document.querySelector("#loan-form");
  if (!modal || !form) return;
  const loan = (state.data.wallet.loans || []).find((item) => item.id === loanId);
  stateStore.setUI({ editingLoanId: loan?.id || null });
  form.reset();
  form.elements.name.value = loan?.name || "";
  form.elements.amount.value = loan?.amount || "";
  form.elements.method.value = loan?.method || "once";
  form.elements.institution.value = loan?.institution || "";
  form.elements.dueDate.value = loan?.dueDate || getDateString();
  form.elements.monthlyPayment.value = loan?.monthlyPayment || "";
  form.elements.paymentDay.value = loan?.paymentDay || "";
  form.elements.lastPaymentDate.value = loan?.lastPaymentDate || "";
  form.elements.manualSchedule.value = (loan?.manualSchedule || []).map((payment) => `${payment.date}, ${payment.amount}`).join("\n");
  form.elements.comment.value = loan?.comment || "";
  modal.querySelector("h2").textContent = loan ? "Edit loan" : "Add loan";
  form.querySelector('[type="submit"]').textContent = loan ? "Save changes" : "Save loan";
  updateLoanMethodFields();
  modal.classList.add("open");
}

function setupLoans() {
  const modal = document.querySelector("#loan-modal");
  const form = document.querySelector("#loan-form");
  const close = () => { modal?.classList.remove("open"); form?.reset(); stateStore.setUI({ editingLoanId: null }); };
  document.querySelector("#add-loan-btn")?.addEventListener("click", () => openLoanModal());
  document.querySelector("#loan-method")?.addEventListener("change", updateLoanMethodFields);
  document.querySelector("#close-loan-modal")?.addEventListener("click", close);
  document.querySelector("#cancel-loan")?.addEventListener("click", close);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton?.disabled) return;
    const values = new FormData(form);
    const amount = normalizeNumber(values.get("amount"));
    const manualSchedule = String(values.get("manualSchedule") || "").split(/\r?\n/).map((line) => { const [date, value] = line.split(",").map((part) => part.trim()); return { id: `loan-payment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, date, amount: normalizeNumber(value), paid: false }; }).filter((payment) => payment.date && payment.amount > 0);
    const previous = state.data.wallet.loans.find((loan) => loan.id === state.editingLoanId);
    const paidAmount = previous ? normalizeNumber(previous.amount) - normalizeNumber(previous.balance) : 0;
    const loan = { id: previous?.id || `loan-${Date.now()}`, createdAt: previous?.createdAt || new Date().toISOString(), name: String(values.get("name") || "").trim(), amount, balance: Math.max(0, amount - paidAmount), method: values.get("method"), institution: String(values.get("institution") || "").trim(), dueDate: values.get("dueDate"), monthlyPayment: normalizeNumber(values.get("monthlyPayment")), paymentDay: normalizeNumber(values.get("paymentDay")), lastPaymentDate: values.get("lastPaymentDate") || null, manualSchedule, comment: String(values.get("comment") || "").trim(), repayments: previous?.repayments || [], status: amount > paidAmount ? "active" : "paid" };
    if (submitButton) submitButton.disabled = true;
    try {
      await walletActions.mutate(wallet => {
        const index = wallet.loans.findIndex(item => item.id === loan.id);
        if (index >= 0) wallet.loans[index] = loan;
        else wallet.loans.push(loan);
      });
    } catch (error) { void showNotice(error || 'Failed to save wallet.'); return; }
    finally { if (submitButton) submitButton.disabled = false; }
    close();
    renderLoans();
  });
}
Object.assign(window, { updateLoanMethodFields, openLoanModal, setupLoans });
})();
