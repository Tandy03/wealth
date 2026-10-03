(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoWalletAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ state, values, categories }) {
    const { normalizeNumber, getDateString } = values;
    const WALLET_CATEGORIES = categories;
function walletMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeWalletCategoryNames() {
  const replacements = {
    "Groceries + household goods": "Groceries + household",
    "Other expenses": "Other",
    Savings: "Save+invest",
  };
  const wallet = state.data.wallet;
  (wallet.expenses || []).forEach((expense) => { expense.category = replacements[expense.category] || expense.category; });
  Object.values(wallet.months || {}).forEach((month) => {
    Object.entries(replacements).forEach(([oldName, newName]) => {
      if (month.plans?.[oldName] != null) {
        month.plans[newName] = month.plans[oldName];
        delete month.plans[oldName];
      }
    });
    month.customCategories = (month.customCategories || []).map((name) => replacements[name] || name);
  });
}

function walletMonth(key) {
  const wallet = state.data.wallet;
  wallet.expenses ||= [];
  wallet.months ||= {};
  wallet.months[key] ||= { plans: {}, customCategories: [], notes: [] };
  wallet.months[key].plans ||= {};
  wallet.months[key].customCategories ||= [];
  wallet.months[key].notes ||= [];
  return wallet.months[key];
}

function walletCategories(key) {
  return [...new Set([...WALLET_CATEGORIES, ...walletMonthView(key).customCategories])];
}
function walletMonthView(key) {
  const month = state.data.wallet.months?.[key] || {};
  return { ...month, plans: month.plans || {}, customCategories: month.customCategories || [], notes: month.notes || [] };
}

function walletExpenses(key) {
  return (state.data.wallet.expenses || []).filter((expense) => String(expense.date).slice(0, 7) === key);
}

function walletCategoryTotal(key, category) {
  return walletExpenses(key)
    .filter((expense) => expense.category === category)
    .reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0);
}

function cleanupUnusedWalletCategories() {
  Object.entries(state.data.wallet.months || {}).forEach(([key, month]) => {
    month.customCategories = (month.customCategories || []).filter((category) => {
      const stillUsed = walletExpenses(key).some((expense) => expense.category === category);
      if (!stillUsed && month.plans) delete month.plans[category];
      return stillUsed;
    });
  });
}

function walletExpenseDateBounds() {
  const dates = (state.data.wallet.expenses || [])
    .filter((expense) => expense.category !== "Salary" && /^\d{4}-\d{2}-\d{2}$/.test(String(expense.date)))
    .map((expense) => expense.date)
    .sort();
  const today = getDateString();
  return { first: dates[0] || today, last: dates.at(-1) || today, today };
}

function shiftWalletDate(dateString, { days = 0, months = 0, years = 0 }) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getLoanSchedule(loan) {
  if (loan.status === "paid") return [];
  if (loan.method === "manual") return (loan.manualSchedule || []).filter((payment) => !payment.paid).map((payment) => ({ ...payment, loanId: loan.id }));
  if (loan.method !== "monthly") return [{ date: loan.dueDate, amount: normalizeNumber(loan.balance), loanId: loan.id }];
  const result = [];
  let balance = normalizeNumber(loan.balance);
  let cursor = new Date(`${loan.dueDate}T00:00:00`);
  const lastPaymentDate = loan.lastPaymentDate ? new Date(`${loan.lastPaymentDate}T23:59:59`) : null;
  const payment = Math.max(0.01, normalizeNumber(loan.monthlyPayment));
  while (balance > 0 && result.length < 120 && (!lastPaymentDate || cursor <= lastPaymentDate)) {
    result.push({ date: getDateString(cursor), amount: Math.min(payment, balance), loanId: loan.id });
    balance -= payment;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, Math.min(normalizeNumber(loan.paymentDay) || cursor.getDate(), 28));
  }
  return result;
}
    return { walletMonthKey, normalizeWalletCategoryNames, walletMonth, walletMonthView, walletCategories, walletExpenses, walletCategoryTotal, cleanupUnusedWalletCategories, walletExpenseDateBounds, shiftWalletDate, getLoanSchedule };
  }
  return { createService };
});
