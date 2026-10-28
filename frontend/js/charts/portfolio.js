// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createChartsPortfolio({
  FinoChartPlugins,
  FinoI18n,
  PortfolioPerformance,
  charts,
  createRenderServices,
  document,
  escapeHtml,
  getComputedStyle,
  getDateString,
  money,
  normalizeNumber,
  stateStore,
  typeLabels,
  window,
}) {
let assetAllocationChart = null, allocationMode = null;
const stackedDoughnutLegendPlugin = FinoChartPlugins.stackedDoughnutLegend;
function renderAssetAllocationChart(state = stateStore.getState()) {
  const canvas = document.querySelector('#asset-allocation-chart');
  if (!canvas || typeof charts.current === 'undefined') return;
  const { toUAH, getAvailableQuantity, getCurrentPrice } = createRenderServices(state);
  const mode = document.querySelector('#asset-allocation-mode')?.value || 'assets';
  const allocation = new Map();
  for (const asset of stateStore.selectAssets(state) || []) {
    if (asset.type === 'savings') continue;
    const value = toUAH(getAvailableQuantity(asset.id) * getCurrentPrice(asset), asset.currency);
    const label = mode === 'tools' ? String(asset.instrumentName || '').trim() || FinoI18n.t('Unassigned') : FinoI18n.t(FinoI18n.locale === 'uk' && asset.type === 'stock' ? 'Stocks' : typeLabels[asset.type] || asset.type);
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
  const percent = value => new Intl.NumberFormat(FinoI18n.locale, { style: 'percent', maximumFractionDigits: 1 }).format(total ? value / total : 0);
  const amount = value => new Intl.NumberFormat(FinoI18n.locale, { style: 'currency', currency: 'UAH', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(value);
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
  if (!assetAllocationChart) assetAllocationChart = new charts.current(canvas, { type: 'doughnut', data, plugins: [stackedDoughnutLegendPlugin], options });
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
  const canvas = document.querySelector('#portfolio-history-chart');
  if (!canvas || typeof charts.current === 'undefined') return;
  const mode = document.querySelector('#portfolio-history-mode')?.value || 'value';
  const currency = document.querySelector('#portfolio-history-currency')?.value === 'USD' ? 'USD' : 'UAH';
  const locale = FinoI18n?.locale || 'en';
  const today = getDateString(new Date());
  const period = document.querySelector('#portfolio-history-period')?.value || 'all';
  const fromInput = document.querySelector('#portfolio-history-from'), toInput = document.querySelector('#portfolio-history-to');
  const custom = period === 'custom';
  document.querySelectorAll('[data-portfolio-history-custom]').forEach(label => { label.hidden = !custom; });
  let from = '', to = today;
  if (custom) { from = fromInput?.value || ''; to = toInput?.value || today; }
  else if (period === 'ytd') from = `${today.slice(0, 4)}-01-01`;
  else if (['30d', '3m', '6m', '1y'].includes(period)) {
    const start = new Date(`${today}T12:00:00`);
    if (period === '30d') start.setDate(start.getDate() - 29);
    else {
      const day = start.getDate(); start.setDate(1);
      start.setMonth(start.getMonth() - ({ '3m': 3, '6m': 6, '1y': 12 })[period]);
      start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
    }
    from = getDateString(start);
  }
  if (!custom) { if (fromInput) fromInput.value = from; if (toInput) toInput.value = to; }
  const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) &&
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  const invalidRange = !validDate(to) || to > today || Boolean(from && (!validDate(from) || from > to)) ||
    Boolean(fromInput?.validity.badInput || toInput?.validity.badInput);
  const rangeError = invalidRange ? FinoI18n.t('Choose valid dates ending no later than today.') : '';
  if (fromInput) { fromInput.max = to <= today ? to : today; fromInput.setCustomValidity(rangeError); fromInput.setAttribute('aria-invalid', String(invalidRange)); }
  if (toInput) { toInput.min = from; toInput.max = today; toInput.setCustomValidity(rangeError); toInput.setAttribute('aria-invalid', String(invalidRange)); }
  const history = stateStore.selectUI('purchaseExchangeRates', state) || {};
  const indexes = new Map();
  const officialRate = (code, date) => {
    if (code === 'UAH') return 1;
    if (!indexes.has(code)) indexes.set(code, (Array.isArray(history[code]) ? history[code] : [])
      .filter(point => point && /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(Date.parse(point.date)) &&
        new Date(point.date + 'T00:00:00Z').toISOString().slice(0, 10) === point.date && Number.isFinite(Number(point.rate)) && Number(point.rate) > 0)
      .slice().sort((a, b) => a.date.localeCompare(b.date)));
    const series = indexes.get(code);
    let low = 0, high = series.length;
    while (low < high) { const middle = (low + high) >>> 1; if (series[middle].date <= date) low = middle + 1; else high = middle; }
    const point = series[low - 1];
    // Official weekend/holiday observations may carry forward, never backward.
    return point && (Date.parse(date) - Date.parse(point.date)) / 86400000 <= 7 ? Number(point.rate) : null;
  };
  const performance = invalidRange ? { points: [], flows: [] } : PortfolioPerformance.buildWeeklyPerformance(stateStore.selectData(state), {
    today: to, startDate: from, currency, currentPricesAsOf: today, exchangeRateOnDate: officialRate,
  });
  const points = performance.points.filter(point => (!from || point.date >= from) && point.date <= to);
  const flows = performance.flows.filter(flow => (!from || flow.date >= from) && flow.date <= to);
  const weeklyLabels = points.map(point => new Date(`${point.date}T12:00:00`).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }));
  const months = new Map();
  for (const flow of flows) {
    const key = flow.date.slice(0, 7);
    const month = months.get(key) || { invested: 0, earned: 0 };
    for (const field of ['invested', 'earned']) month[field] = month[field] === null || flow[field] === null ? null : month[field] + flow[field];
    months.set(key, month);
  }
  const monthlyLabels = [], investedValues = [], earnedValues = [];
  const first = points.length || flows.length ? from || [...flows.map(flow => flow.date), ...points.map(point => point.date)].sort()[0] : null;
  if (first) {
    const cursor = new Date(`${first.slice(0, 7)}-01T12:00:00Z`);
    while (cursor.toISOString().slice(0, 7) <= to.slice(0, 7)) {
      const totals = months.get(cursor.toISOString().slice(0, 7)) || { invested: 0, earned: 0 };
      monthlyLabels.push(cursor.toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }));
      investedValues.push(totals.invested); earnedValues.push(totals.earned);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const modes = {
    value: { label: 'Portfolio value', description: 'Portfolio value by week', labels: weeklyLabels,
      values: points.map(point => point.portfolioValue), type: 'line', color: '#7c8cff', background: 'rgba(124, 140, 255, 0.18)' },
    profit: { label: 'Cumulative portfolio profit', description: 'Realized and unrealized profit by week', labels: weeklyLabels,
      values: points.map(point => point.value), type: 'line', color: '#49c58b', background: 'rgba(73, 197, 139, 0.18)' },
    earned: { label: 'Money earned', description: 'Income and realized profit by month', labels: monthlyLabels,
      values: earnedValues, type: 'bar', color: '#e8a33a', background: 'rgba(232, 163, 58, 0.65)' },
    invested: { label: 'Invested by month', description: 'Purchases minus the cost of units sold, by month', labels: monthlyLabels,
      values: investedValues, type: 'bar', color: '#7c8cff', background: 'rgba(124, 140, 255, 0.68)' },
  };
  const selected = modes[mode] || modes.value;
  const description = document.querySelector('#portfolio-history-description');
  if (description) description.textContent = FinoI18n.t(selected.description);
  const note = document.querySelector('#portfolio-history-note');
  if (note) {
    const explanation = FinoI18n.t('Values use the last recorded price and the exchange rate for each date.');
    note.textContent = selected.values.some(value => value === null)
      ? `${explanation} ${FinoI18n.t('Missing historical data is shown as gaps.')}` : explanation;
    if (mode === 'profit') {
      if (currency === 'USD') note.textContent += ` ${FinoI18n.t('USD profit includes exchange-rate gains and losses on invested capital.')}`;
      if (from) note.textContent += ` ${FinoI18n.t('Cumulative profit retains operations before the selected period.')}`;
      const last = points.at(-1);
      if (last?.value != null && [last.realized, last.income, last.unrealized].every(Number.isFinite)) note.textContent += ` ${FinoI18n.t('Realized result')}: ${money(last.realized + last.income, currency)}; ${FinoI18n.t('Unrealized result')}: ${money(last.unrealized, currency)}.`;
    }
    if (!selected.values.length) note.textContent = FinoI18n.t('No data in the selected period.');
    if (invalidRange) note.textContent = rangeError;
  }
  const styles = getComputedStyle(document.documentElement);
  const chartText = styles.getPropertyValue('--text').trim(), gridColor = styles.getPropertyValue('--border').trim();
  portfolioHistoryChart?.destroy();
  portfolioHistoryChart = new charts.current(canvas, {
    type: selected.type,
    data: { labels: selected.labels, datasets: [{ label: `${FinoI18n.t(selected.label)} · ${currency}`, data: selected.values,
      borderColor: selected.color, backgroundColor: selected.background, fill: selected.type === 'line', spanGaps: false,
      tension: 0.28, pointRadius: selected.type === 'line' ? (selected.values.length > 90 ? 0 : 3) : 0,
      borderRadius: selected.type === 'bar' ? 5 : 0 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${FinoI18n.t(selected.label)}: ${money(context.raw, currency)}` } } },
      scales: { x: { ticks: { color: chartText }, grid: { color: gridColor } },
        y: { ticks: { color: chartText, callback: value => money(value, currency) }, grid: { color: gridColor } } },
    },
  });
}

let assetPriceHistoryChart = null;

function renderAssetPriceHistoryChart(state = stateStore.getState(), appearanceOnly = false) {
  const smooth = document.querySelector('#asset-price-history-appearance [aria-pressed="true"]')?.dataset.priceChartStyle === 'smooth';
  const appearance = { tension: 0, cubicInterpolationMode: smooth ? 'monotone' : 'default', pointRadius: smooth ? 1.5 : 4, pointHoverRadius: 5, pointHitRadius: 8 };
  if (appearanceOnly) {
    if (assetPriceHistoryChart) { Object.assign(assetPriceHistoryChart.data.datasets[0], appearance); assetPriceHistoryChart.update('none'); }
    return;
  }
  const { getAvailableQuantity } = createRenderServices(state);
  const canvas = document.querySelector("#asset-price-history-chart");
  const select = document.querySelector("#asset-price-history-select");
  const description = document.querySelector("#asset-price-history-description");
  if (!canvas || !select || typeof charts.current === "undefined") return;

  const from = document.querySelector("#asset-price-history-from");
  const to = document.querySelector("#asset-price-history-to");
  const start = from?.value || "";
  const end = to?.value || "";
  const invalidRange = Boolean(start && end && start > end);
  const rangeError = FinoI18n.t("The end date must be on or after the start date.");
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
        ? `${group.name}: ${FinoI18n.t(`${points.length} recorded price point${points.length === 1 ? "" : "s"}`)}`
        : FinoI18n.t(history.length && (start || end)
          ? "{value}: no recorded prices in the selected period"
          : "{value}: price history will appear after the next edit or synchronization").replace("{value}", group.name)
      : FinoI18n.t("No active portfolio assets");
  }

  const chartText = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();
  assetPriceHistoryChart = new charts.current(canvas, {
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
        fill: true, ...appearance,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      parsing: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items.length ? new Date(items[0].parsed.x).toLocaleString(FinoI18n?.locale || "en", {
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
            callback: (value) => new Date(value).toLocaleDateString(FinoI18n?.locale || "en", { day: "2-digit", month: "2-digit" }),
          },
          grid: { color: gridColor },
        },
        y: { ticks: { color: chartText, callback: (value) => money(value, currency) }, grid: { color: gridColor } },
      },
    },
  });
}
return { renderAssetAllocationChart, renderAssetPriceHistoryChart, renderPortfolioHistoryChart };
}
