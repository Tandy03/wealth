import readers from './state-store.js';
const implementation = (function (readers) {
  function createService({ state, selectData, selectUI, values, categories }) {
    ({ selectData, selectUI } = readers.createReader({ state, selectData, selectUI }));
    const { normalizeNumber, getDateString } = values;
    const WALLET_CATEGORIES = categories;
function walletMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function walletCategories(key) {
  return [...new Set([...WALLET_CATEGORIES, ...walletMonthView(key).customCategories])];
}
function walletMonthView(key) {
  const month = selectData().wallet.months?.[key] || {};
  return { ...month, plans: month.plans || {}, customCategories: month.customCategories || [], notes: month.notes || [] };
}

function walletExpenses(key) {
  return (selectData().wallet.expenses || []).filter((expense) => String(expense.date).slice(0, 7) === key);
}

function walletCategoryTotal(key, category) {
  return walletExpenses(key)
    .filter((expense) => expense.category === category)
    .reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0);
}

function walletExpenseDateBounds() {
  const dates = (selectData().wallet.expenses || [])
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
    return { walletMonthKey, walletMonth: walletMonthView, walletMonthView, walletCategories, walletExpenses, walletCategoryTotal, walletExpenseDateBounds, shiftWalletDate, getLoanSchedule };
  }
  return { createService };
})(readers);
export default implementation;
export const { createService } = implementation;
