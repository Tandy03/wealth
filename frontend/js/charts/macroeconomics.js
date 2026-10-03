(function () {
const state = stateStore.getState();
// charts/macroeconomics.js
let macroCharts = [];

let macroLoaded = false;

function macroYearTick(value) {
  const label = this.getLabelForValue(value);
  return String(label || "").slice(0, 4);
}

function macroLineChart(canvasId, series, label, color, suffix = "%", stepped = false) {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas || typeof Chart === "undefined") return;
  const byDate = new Map((series || []).map((point) => [point.date, point.value]));
  const points = [...byDate].sort(([a], [b]) => a.localeCompare(b));
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: points.map(([date]) => date), datasets: [{ label, data: points.map(([, value]) => value), borderColor: color, backgroundColor: `${color}20`, fill: true, stepped, tension: stepped ? 0 : 0.28, pointRadius: points.length > 45 ? 0 : 2 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback: macroYearTick } }, y: { ticks: { callback: (value) => `${value}${suffix}` } } }, plugins: { legend: { display: false } } },
  });
  macroCharts.push(chart);
}

function macroMultiChart(canvasId, labels, datasets, rightAxis = false) {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas || typeof Chart === "undefined") return;
  macroCharts.push(new Chart(canvas, {
    type: "line",
    data: { labels, datasets: datasets.map((dataset, index) => ({ ...dataset, tension: 0.25, pointRadius: labels.length > 35 ? 0 : 2, borderWidth: 2, yAxisID: dataset.yAxisID || "y", backgroundColor: `${dataset.borderColor}18` })) },
    options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, callback: macroYearTick } }, y: { beginAtZero: false }, ...(rightAxis ? { y1: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: (value) => `${value}%` } } } : {}) }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } } },
  }));
}

async function renderMacroeconomics() {
  const state = document.querySelector("#macro-state");
  const content = document.querySelector("#macro-content");
  if (!state || !content) return;
  state.hidden = false; state.textContent = "Loading official macroeconomic data…";
  try {
    const data = await api.getMacroeconomics();
    macroCharts.forEach((chart) => chart.destroy()); macroCharts = [];
    const symbols = { USD: "$", EUR: "€", GBP: "£" };
    const currencyOrder = { USD: 0, EUR: 1, GBP: 2 };
    const orderedExchangeRates = [...(data.exchangeRates || [])]
      .sort((a, b) => (currencyOrder[a.code] ?? 99) - (currencyOrder[b.code] ?? 99));
    document.querySelector("#macro-fx-cards").innerHTML = orderedExchangeRates.map((rate) => `<article class="macro-fx-card"><span>${escapeHtml(rate.code)} / UAH</span><strong>${symbols[rate.code] || ""}${currencyFormatter.format(rate.rate)}</strong><small>NBU · ${escapeHtml(rate.date || "latest")}</small></article>`).join("");
    macroLineChart("macro-inflation-annual", data.inflation?.annual, "Annual CPI", "#55d68b");
    macroLineChart("macro-inflation-monthly", data.inflation?.monthly, "Monthly CPI", "#7c8cff");
    const gdpDates = [...new Set([...(data.gdp?.nominal || []), ...(data.gdp?.realIndex || [])].map((point) => point.date))].sort();
    macroMultiChart("macro-gdp-chart", gdpDates, [
      { label: "Nominal GDP, UAH million", data: valuesForDates(data.gdp?.nominal, gdpDates), borderColor: "#7c8cff" },
      { label: "Real GDP change, %", data: valuesForDates((data.gdp?.realIndex || []).map((point) => ({ ...point, value: point.value - 100 })), gdpDates), borderColor: "#55d68b", yAxisID: "y1" },
    ], true);
    const errors = Object.entries(data.errors || {});
    const errorNode = document.querySelector("#macro-errors");
    errorNode.hidden = !errors.length;
    errorNode.textContent = errors.length ? `Some sources are temporarily unavailable: ${errors.map(([name]) => name.toUpperCase()).join(", ")}.` : "";
    content.hidden = false; state.hidden = true; macroLoaded = true; stateStore.setUI({ macroLoaded: true });
    const policyState = document.querySelector("#macro-policy-rate-state");
    api.getNbuPolicyRate().then((result) => {
      const rawSeries = result?.policyRate || [];
      const series = rawSeries.filter((point, index) => index === 0 || index === rawSeries.length - 1 || point.value !== rawSeries[index - 1].value);
      macroLineChart("macro-policy-rate", series, "NBU key policy rate", "#e8a33a", "%", true);
      if (policyState) policyState.textContent = series.length ? `NBU · ${series.at(-1).date}` : "No policy-rate data returned";
    }).catch((error) => {
      if (policyState) policyState.textContent = error.message || "Policy-rate data is temporarily unavailable";
    });
  } catch (error) {
    state.textContent = error.message || "Could not load macroeconomic data.";
  }
}

Object.assign(window, { macroYearTick, macroLineChart, macroMultiChart, renderMacroeconomics });
})();
