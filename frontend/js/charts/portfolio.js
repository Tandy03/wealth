(function () {
let assetAllocationChart = null, allocationMode = null;
const stackedDoughnutLegendPlugin = window.FinoChartPlugins.stackedDoughnutLegend;
function renderAssetAllocationChart(state = stateStore.getState()) {
  const canvas = document.querySelector('#asset-allocation-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const { toUAH, getAvailableQuantity, getCurrentPrice } = createRenderServices(state);
  const mode = document.querySelector('#asset-allocation-mode')?.value || 'assets';
  const allocation = new Map();
  for (const asset of stateStore.selectAssets(state) || []) {
    if (asset.type === 'savings') continue;
    const value = toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency);
    const label = mode === 'tools' ? String(asset.instrumentName || '').trim() || window.FinoI18n.t('Unassigned') : window.FinoI18n.t(window.FinoI18n.locale === 'uk' && asset.type === 'stock' ? 'Stocks' : typeLabels[asset.type] || asset.type);
    const key = mode === 'tools' ? label.toLocaleLowerCase() : asset.type;
    const item = allocation.get(key) || { value: 0, label };
    item.value += value; allocation.set(key, item);
  }
  const items = [...allocation.values()].filter(item => item.value > 0);
  const values = items.map(item => item.value);
  const total = values.reduce((sum, value) => sum + value, 0);
  const styles = getComputedStyle(document.getElementById('analytics-section'));
  const token = name => styles.getPropertyValue(name).trim();
  const colors = items.map((_, i) => i < 8 ? token('--rebalance-asset-' + (i + 1)) : 'hsl(' + i * 137.508 % 360 + ' 62% ' + (token('--rebalance-color-lightness') || '55%') + ')');
  const percent = value => new Intl.NumberFormat(window.FinoI18n.locale, { style: 'percent', maximumFractionDigits: 1 }).format(total ? value / total : 0);
  const amount = value => new Intl.NumberFormat(window.FinoI18n.locale, { style: 'currency', currency: 'UAH', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(value);
  const center = document.getElementById('asset-allocation-center');
  if (center) center.textContent = amount(total);
  canvas.parentElement.classList.toggle('is-empty', !total);
  const empty = document.getElementById('asset-allocation-empty');
  if (empty) empty.hidden = total > 0;
  const data = { finoSkipLabels: true, labels: items.map(item => item.label), datasets: [{ data: values, backgroundColor: colors,
    borderWidth: 2, borderColor: token('--surface'), hoverOffset: 5 }] };
  const options = {
    responsive: true, maintainAspectRatio: false, cutout: '74%',
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 220 },
    plugins: {
      legend: { display: false, labels: { generateLabels: chart => chart.data.labels.map((label, index) => ({
        text: label, share: percent(chart.data.datasets[0].data[index]), fillStyle: chart.data.datasets[0].backgroundColor[index],
        strokeStyle: token('--surface'), lineWidth: 2, hidden: !chart.getDataVisibility(index), index,
        fontColor: token('--chart-legend-text'),
      })) } },
      stackedDoughnutLegend: { containerId: 'asset-allocation-legend' },
      tooltip: { finoSkipLabels: true, backgroundColor: token('--surface'), borderColor: token('--border'), borderWidth: 1,
        titleColor: token('--text'), bodyColor: token('--text'), callbacks: {
          title: rows => rows[0]?.label || '', label: context => percent(context.raw || 0) + ' · ' + amount(context.raw || 0),
        } },
    },
  };
  if (!assetAllocationChart) assetAllocationChart = new Chart(canvas, { type: 'doughnut', data, plugins: [stackedDoughnutLegendPlugin], options });
  else {
    if (allocationMode !== mode) values.forEach((_, i) => { if (assetAllocationChart.getDataVisibility?.(i) === false) assetAllocationChart.toggleDataVisibility(i); });
    assetAllocationChart.data = data;
    assetAllocationChart.options.plugins = options.plugins;
    assetAllocationChart.update('none');
  }
  allocationMode = mode;
}

let portfolioHistoryChart = null;

function renderPortfolioHistoryChart(state = stateStore.getState()) {
  const { toUAH, toUAHAtDate, getAssetPurchaseDate, toUAHPurchaseCost, getMaturityCostBasis, getCurrentPrice } = createRenderServices(state);
  const canvas = document.querySelector("#portfolio-history-chart");

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  const mode = document.querySelector("#portfolio-history-mode")?.value || "value";
  const description = document.querySelector("#portfolio-history-description");
  const assetsById = new Map((stateStore.selectAssets(state) || []).map((asset) => [asset.id, asset]));
  const movements = (stateStore.selectTransactions(state) || [])
    .filter((transaction) => {
      const asset = assetsById.get(transaction.assetId);
      return asset?.type !== "savings" && transaction.date && ["BUY", "SELL"].includes(transaction.type);
    })
    .map((transaction) => ({
      date: transaction.date,
      assetId: transaction.assetId,
      quantity: (transaction.type === "BUY" ? 1 : -1) * normalizeNumber(transaction.quantity),
      amount:
        transaction.type === "BUY"
          ? toUAHAtDate(transaction.amount, transaction.currency, transaction.date)
          : -toUAHPurchaseCost(
            transaction.costBasis ?? transaction.amount,
            transaction.currency,
            transaction.assetId,
            getAssetPurchaseDate(transaction.assetId, transaction.date),
          ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (portfolioHistoryChart) {
    portfolioHistoryChart.destroy();
  }

  const earnedEvents = [
    ...(stateStore.selectPayments(state) || [])
      .filter((payment) => payment.status === "received" || payment.status === "paid")
      .map((payment) => {
        const date = payment.receivedDate || String(payment.receivedAt || "").slice(0, 10) || payment.date;
        const maturityBasis = payment.type === "MATURITY" ? getMaturityCostBasis(payment.assetId) : 0;
        return { date, amount: toUAH(normalizeNumber(payment.amount) - maturityBasis, payment.currency) };
      }),
    ...(stateStore.selectSales(state) || [])
      .filter((sale) => sale.type !== "savings" && sale.sellDate)
      .map((sale) => ({
        date: sale.sellDate,
        amount: toUAH(normalizeNumber(sale.profit), sale.currency),
      })),
  ].filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(String(event.date))).sort((a, b) => a.date.localeCompare(b.date));

  const datedEvents = [...movements, ...earnedEvents];

  if (!datedEvents.length) {
    portfolioHistoryChart = new Chart(canvas, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: { responsive: true, maintainAspectRatio: false },
    });
    return;
  }

  const firstEventDate = datedEvents.map((event) => event.date).sort()[0];
  const firstDate = new Date(`${firstEventDate}T00:00:00`);
  const lastDate = new Date();
  const labels = [];
  const investedValues = [];
  const monthlyInvestedValues = [];
  const portfolioValues = [];
  const earnedValues = [];
  const quantities = new Map();
  let runningInvested = 0;
  let movementIndex = 0;
  let earnedIndex = 0;
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  const lastMonth = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);

  while (cursor <= lastMonth) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const monthEndString = getDateString(monthEnd);

    let investedThisMonth = 0;
    while (movementIndex < movements.length && movements[movementIndex].date <= monthEndString) {
      const movement = movements[movementIndex];
      runningInvested += movement.amount;
      investedThisMonth += movement.amount;
      quantities.set(movement.assetId, normalizeNumber(quantities.get(movement.assetId)) + movement.quantity);
      movementIndex += 1;
    }

    let earnedThisMonth = 0;
    const monthKey = getDateString(cursor).slice(0, 7);
    while (earnedIndex < earnedEvents.length && earnedEvents[earnedIndex].date.slice(0, 7) <= monthKey) {
      if (earnedEvents[earnedIndex].date.slice(0, 7) === monthKey) earnedThisMonth += earnedEvents[earnedIndex].amount;
      earnedIndex += 1;
    }

    const portfolioValue = [...quantities.entries()].reduce((sum, [assetId, quantity]) => {
      const asset = assetsById.get(assetId);
      if (!asset || quantity <= 0) return sum;
      return sum + toUAH(quantity * getCurrentPrice(asset), asset.currency);
    }, 0);

    labels.push(cursor.toLocaleDateString(window.FinoI18n?.locale || "en", { month: "short", year: "numeric" }));
    investedValues.push(Math.max(0, runningInvested));
    monthlyInvestedValues.push(investedThisMonth);
    portfolioValues.push(Math.max(0, portfolioValue));
    earnedValues.push(earnedThisMonth);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const strictHistoricalRate = (currency, date) => {
    const normalizedCurrency = String(currency || "UAH").toUpperCase();
    if (normalizedCurrency === "UAH") return 1;
    const rates = state.purchaseExchangeRates[normalizedCurrency] || [];
    const point = [...rates].reverse().find((item) => item.date <= date);
    return point && normalizeNumber(point.rate) > 0 ? normalizeNumber(point.rate) : null;
  };
  const weeklyPerformance = window.PortfolioPerformance.buildWeeklyPerformance(stateStore.selectData(state), {
    today: getDateString(new Date()),
    exchangeRateOnDate: strictHistoricalRate,
  });
  const weeklyDifferenceLabels = weeklyPerformance.points.map((point) => new Date(`${point.date}T12:00:00`).toLocaleDateString(window.FinoI18n?.locale || "en"));
  const weeklyDifferenceValues = weeklyPerformance.points.map((point) => point.value);

  const chartModes = {
    value: {
      label: "Portfolio value",
      description: "Portfolio value by month",
      values: portfolioValues,
      type: "line",
      color: "#7c8cff",
      background: "rgba(124, 140, 255, 0.18)",
    },
    profit: {
      label: "Cumulative portfolio profit",
      description: weeklyPerformance.limitations.length
        ? "Weekly profit. Gaps indicate missing historical data."
        : "Realized and unrealized profit by week",
      values: weeklyDifferenceValues,
      labels: weeklyDifferenceLabels,
      type: "line",
      color: "#49c58b",
      background: "rgba(73, 197, 139, 0.18)",
    },
    earned: {
      label: "Money earned",
      description: "Income and realized profit by month",
      values: earnedValues,
      type: "bar",
      color: "#e8a33a",
      background: "rgba(232, 163, 58, 0.65)",
    },
    invested: {
      label: "Invested by month",
      description: "Purchases minus the cost of units sold, by month (UAH)",
      values: monthlyInvestedValues,
      type: "bar",
      color: "#7c8cff",
      background: "rgba(124, 140, 255, 0.68)",
    },
  };
  const selected = chartModes[mode] || chartModes.value;
  if (description) description.textContent = window.FinoI18n.t(selected.description);

  const chartText = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();

  portfolioHistoryChart = new Chart(canvas, {
    type: selected.type,
    data: {
      labels: selected.labels || labels,
      datasets: [{
        label: selected.label,
        data: selected.values,
        borderColor: selected.color,
        backgroundColor: selected.background,
        fill: selected.type === "line",
        tension: 0.28,
        pointRadius: selected.type === "line" ? (selected.values.length > 90 ? 0 : 3) : 0,
        borderRadius: selected.type === "bar" ? 5 : 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (context) => `${window.FinoI18n.t(selected.label)}: ${money(context.raw)}` } },
      },
      scales: {
        x: { ticks: { color: chartText }, grid: { color: gridColor } },
        y: { ticks: { color: chartText, callback: (value) => money(value) }, grid: { color: gridColor } },
      },
    },
  });
}

let assetPriceHistoryChart = null;

function renderAssetPriceHistoryChart(state = stateStore.getState()) {
  const { getAvailableQuantity } = createRenderServices(state);
  const canvas = document.querySelector("#asset-price-history-chart");
  const select = document.querySelector("#asset-price-history-select");
  const description = document.querySelector("#asset-price-history-description");
  if (!canvas || !select || typeof Chart === "undefined") return;

  const from = document.querySelector("#asset-price-history-from");
  const to = document.querySelector("#asset-price-history-to");
  const start = from?.value || "";
  const end = to?.value || "";
  const invalidRange = Boolean(start && end && start > end);
  const rangeError = window.FinoI18n.t("The end date must be on or after the start date.");
  if (from) from.max = end;
  if (to) {
    to.min = start;
    to.setCustomValidity(invalidRange ? rangeError : "");
  }
  const minTime = start ? new Date(`${start}T00:00:00`).getTime() : null;
  const endDate = end ? new Date(`${end}T00:00:00`) : null;
  if (endDate) endDate.setDate(endDate.getDate() + 1);
  const maxTime = endDate ? endDate.getTime() - 1 : null;

  const groups = new Map();
  (stateStore.selectAssets(state) || [])
    .filter((asset) => getAvailableQuantity(asset.id) > 0 && asset.type !== "savings")
    .filter((asset) => ![asset.name, asset.symbol].some((value) => String(value || "").trim().toUpperCase() === "USDT"))
    .forEach((asset) => {
      const key = `${asset.type}::${String(asset.name || "").trim().toLocaleLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { key, name: asset.name, assetIds: [] });
      groups.get(key).assetIds.push(asset.id);
    });

  const previousValue = select.value;
  select.innerHTML = [...groups.values()]
    .map((group) => `<option translate="no" value="${escapeHtml(group.key)}">${escapeHtml(group.name)}</option>`)
    .join("");
  if (groups.has(previousValue)) select.value = previousValue;

  assetPriceHistoryChart?.destroy();
  assetPriceHistoryChart = null;
  const group = groups.get(select.value);
  const history = group ? (stateStore.selectPriceHistory(state) || [])
    .filter((point) => group.assetIds.includes(point.assetId) && normalizeNumber(point.price) > 0)
    .map((point) => ({ ...point, timestamp: new Date(point.recordedAt || `${point.date}T00:00:00`).getTime() }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp) : [];
  const points = invalidRange ? [] : history.filter(point =>
    (minTime == null || point.timestamp >= minTime) && (maxTime == null || point.timestamp <= maxTime));
  const currency = history.at(-1)?.currency || "UAH";
  if (description) {
    description.setAttribute("translate", "no");
    description.setAttribute("aria-live", "polite");
    description.textContent = invalidRange ? rangeError : group
      ? points.length
        ? `${group.name}: ${window.FinoI18n.t(`${points.length} recorded price point${points.length === 1 ? "" : "s"}`)}`
        : window.FinoI18n.t(history.length && (start || end)
          ? "{value}: no recorded prices in the selected period"
          : "{value}: price history will appear after the next edit or synchronization").replace("{value}", group.name)
      : window.FinoI18n.t("No active portfolio assets");
  }

  const chartText = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();
  assetPriceHistoryChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: group?.name || "Asset price",
        finoSkipLabels: Boolean(group),
        data: points.map((point) => ({
          x: point.timestamp,
          y: normalizeNumber(point.price),
        })).filter((point) => Number.isFinite(point.x)),
        borderColor: "#7c8cff", backgroundColor: "rgba(124, 140, 255, 0.18)",
        fill: true, tension: 0.25, pointRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items.length ? new Date(items[0].parsed.x).toLocaleString(window.FinoI18n?.locale || "en", {
              day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
            }) : "",
            label: (context) => money(context.parsed.y, currency),
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ...(!invalidRange && minTime != null ? { min: minTime } : {}),
          ...(!invalidRange && maxTime != null ? { max: maxTime } : {}),
          ticks: {
            color: chartText, maxRotation: 0, autoSkip: true,
            maxTicksLimit: window.innerWidth <= 700 ? 4 : 8,
            callback: (value) => new Date(value).toLocaleDateString(window.FinoI18n?.locale || "en", { day: "2-digit", month: "2-digit" }),
          },
          grid: { color: gridColor },
        },
        y: { ticks: { color: chartText, callback: (value) => money(value, currency) }, grid: { color: gridColor } },
      },
    },
  });
}

Object.assign(window, { renderAssetAllocationChart, renderPortfolioHistoryChart, renderAssetPriceHistoryChart });
})();
