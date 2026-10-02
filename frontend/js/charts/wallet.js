// charts/wallet.js
let walletCategoryChart = null;

let walletDailyChart = null;

let walletMonthlyChart = null;

let walletPeriodChart = null;

function walletMonthAxisTicks() {
  return {
    autoSkip: true,
    maxTicksLimit: window.innerWidth <= 700 ? 4 : 8,
    minRotation: 0,
    maxRotation: 0,
    callback(value) {
      const label = String(this.getLabelForValue(value) || "");
      const month = label.slice(0, 7);
      return /^\d{4}-\d{2}$/.test(month) ? month : label;
    },
  };
}

function applyWalletPeriodPreset() {
  const preset = document.querySelector("#wallet-period-preset")?.value || "all";
  const fromInput = document.querySelector("#wallet-period-from");
  const toInput = document.querySelector("#wallet-period-to");
  if (!fromInput || !toInput || preset === "custom") return;
  const { first, last, today } = walletExpenseDateBounds();
  const ranges = {
    all: [first, last],
    "7d": [shiftWalletDate(today, { days: -6 }), today],
    "30d": [shiftWalletDate(today, { days: -29 }), today],
    "3m": [shiftWalletDate(today, { months: -3 }), today],
    ytd: [`${today.slice(0, 4)}-01-01`, today],
    "1y": [shiftWalletDate(today, { years: -1 }), today],
  };
  [fromInput.value, toInput.value] = ranges[preset] || ranges.all;
}

function renderWalletPeriodChart() {
  const fromInput = document.querySelector("#wallet-period-from");
  const toInput = document.querySelector("#wallet-period-to");
  const totalElement = document.querySelector("#wallet-period-total");
  const mode = document.querySelector("#wallet-period-mode")?.value || "__total__";
  const caption = document.querySelector("#wallet-period-caption");
  const canvas = document.querySelector("#wallet-period-chart");
  if (!fromInput || !toInput || !totalElement || !canvas) return;
  if (document.querySelector("#wallet-period-preset")?.value !== "custom" || !fromInput.value || !toInput.value) applyWalletPeriodPreset();

  const from = fromInput.value;
  const to = toInput.value;
  const expenses = (state.data.wallet.expenses || []).filter((expense) => {
    const category = String(expense.category || "").trim().toLowerCase();
    const isExpense = category !== "salary";
    const isRegularExpense = isExpense && category !== "tithe" && category !== "save+invest" && category !== "savings";
    return (mode === "__expenses__" ? isRegularExpense : isExpense) && expense.date >= from && expense.date <= to;
  });
  const total = expenses.reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0);
  totalElement.textContent = walletMoney(total);
  if (caption) caption.textContent = mode === "__expenses__" ? "Cumulative expenses excluding Tithe and Save+invest by day." : "Cumulative total expenses by day.";

  const dailyTotals = expenses.reduce((result, expense) => {
    result[expense.date] = (result[expense.date] || 0) + normalizeNumber(expense.amount);
    return result;
  }, {});
  const labels = [];
  const cumulativeValues = [];
  if (from && to && from <= to) {
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    let cumulative = 0;
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      cumulative += dailyTotals[date] || 0;
      labels.push(date);
      cumulativeValues.push(cumulative);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  walletPeriodChart?.destroy();
  walletPeriodChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ label: mode === "__expenses__" ? "Cumulative expenses" : "Cumulative total", data: cumulativeValues, borderColor: "#49c58b", backgroundColor: "rgba(73,197,139,.14)", fill: true, tension: .22, pointRadius: labels.length > 60 ? 0 : 2, pointHoverRadius: 4, borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        title: { display: true, text: mode === "__expenses__" ? "Expenses excluding Tithe and Save+invest" : "Total expenses during the selected period" },
        tooltip: { callbacks: { label: (item) => walletMoney(item.parsed.y) } },
      },
      scales: {
        x: { ticks: walletMonthAxisTicks() },
        y: { beginAtZero: true, ticks: { callback: (value) => walletMoney(value) } },
      },
    },
  });
}

function renderWalletCategoryChart(key) {
  const expenses = walletExpenses(key).filter((expense) => expense.category !== "Salary");
  const categories = [...new Set(expenses.map((expense) => expense.category))];
  const categoryValues = categories.map((category) => expenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0));
  const chartColors = ["#7395DD", "#F587F0", "#32A328", "#e9a23b", "#7c8cff", "#2bb3a3", "#c76dd8", "#FDBDBA"];
  walletCategoryChart?.destroy();
  walletCategoryChart = new Chart(document.querySelector("#wallet-category-chart"), {
    type: "doughnut",
    data: { labels: categories, datasets: [{ data: categoryValues, backgroundColor: chartColors }] },
    plugins: [stackedDoughnutLegendPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      circumference: 180,
      rotation: 270,
      cutout: "55%",
      plugins: {
        title: { display: true, text: "Spending by category" },
        legend: {
          display: false,
        },
        stackedDoughnutLegend: { containerId: "wallet-category-legend" },
      },
    },
  });
}

function renderWalletDailyChart(key) {
  const expenses = walletExpenses(key).filter((expense) => expense.category !== "Salary");
  const dayCount = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  const dailyValues = days.map((day) => expenses.filter((expense) => Number(expense.date.slice(8, 10)) === day).reduce((sum, expense) => sum + normalizeNumber(expense.amount), 0));
  walletDailyChart?.destroy();
  walletDailyChart = new Chart(document.querySelector("#wallet-daily-chart"), { type: "line", data: { labels: days, datasets: [{ label: "Daily expenses", data: dailyValues, borderColor: "#7395DD", backgroundColor: "rgba(115,149,221,.18)", fill: true, tension: .25 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: false } }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: window.innerWidth <= 700 ? 6 : 10, maxRotation: 0 } } } } });
}

function renderWalletMonthlyChart() {
  const allExpenses = (state.data.wallet.expenses || []).filter((expense) => expense.category !== "Salary");
  const monthlyCategorySelect = document.querySelector("#wallet-monthly-category");
  const previousSelection = monthlyCategorySelect?.value || "__total__";
  const allCategories = [...new Set(allExpenses.map((expense) => expense.category))].sort();
  if (monthlyCategorySelect) {
    monthlyCategorySelect.innerHTML = '<option value="__total__">Total</option><option value="__expenses__">Expenses</option>' + allCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    monthlyCategorySelect.value = allCategories.includes(previousSelection) || ["__total__", "__expenses__"].includes(previousSelection) ? previousSelection : "__total__";
  }
  const selectedCategory = monthlyCategorySelect?.value || "__total__";
  const monthTotals = {};
  allExpenses.forEach((expense) => {
    const month = String(expense.date).slice(0, 7);
    if (!monthTotals[month]) monthTotals[month] = 0;
    const category = String(expense.category || "").trim().toLowerCase();
    if (selectedCategory === "__total__" || (selectedCategory === "__expenses__" && category !== "tithe" && category !== "save+invest" && category !== "savings") || expense.category === selectedCategory) {
      monthTotals[month] += normalizeNumber(expense.amount);
    }
  });
  const months = Object.keys(monthTotals).sort();
  const seriesLabel = selectedCategory === "__total__" ? "Total expenses" : selectedCategory === "__expenses__" ? "Expenses" : selectedCategory;
  walletMonthlyChart?.destroy();
  walletMonthlyChart = new Chart(document.querySelector("#wallet-monthly-chart"), { type: "line", data: { labels: months, datasets: [{ label: seriesLabel, data: months.map((month) => monthTotals[month]), borderColor: "#7c8cff", backgroundColor: "rgba(124,140,255,.18)", fill: true, tension: .3, pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: `${seriesLabel} by month` } }, scales: { x: { ticks: walletMonthAxisTicks() } } } });
}

function renderWalletCharts() {
  if (typeof Chart === "undefined") return;
  const input = document.querySelector("#wallet-chart-month");
  if (!input) return;
  input.value ||= walletMonthKey();
  const key = input.value;
  renderWalletCategoryChart(key);
  renderWalletDailyChart(key);
  renderWalletMonthlyChart();
  renderWalletPeriodChart();
}
