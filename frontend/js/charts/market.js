(function () {
const state = stateStore.getState();
// charts/market.js
let marketPriceChart = null;

let marketRange = "1M";

let marketCustomRange = null;

let marketRequestId = 0;

const marketCurrencies = new Map([
  ["USD", "US Dollar"], ["EUR", "Euro"], ["GBP", "Pound sterling"],
  ["PLN", "Polish zloty"], ["CHF", "Swiss franc"], ["CAD", "Canadian dollar"],
  ["JPY", "Japanese yen"], ["CZK", "Czech koruna"], ["SEK", "Swedish krona"],
]);

function populateMarketSymbols() {
  const datalist = document.querySelector("#market-symbols");
  if (!datalist) return;
  const suggestions = new Set([".INX", ".DJI", ".IXIC", "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "SPY", "QQQ", "SMH"]);
  (state.data?.assets || [])
    .filter((asset) => ["stock", "etf"].includes(asset.type))
    .forEach((asset) => suggestions.add(String(asset.underlyingSymbol || asset.ticker || asset.symbol || asset.name || "").trim().toUpperCase()));
  const currencyOptions = [...marketCurrencies].map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} · ${escapeHtml(code)}/UAH · NBU</option>`);
  currencyOptions.splice(1, 0, '<option value="USEU">USD/EUR · Frankfurter</option>');
  currencyOptions.splice(2, 0, '<option value="EUUS">EUR/USD · Frankfurter</option>');
  const indexNames = { ".INX": "S&P 500 Index", ".DJI": "Dow Jones Industrial Average", ".IXIC": "NASDAQ Composite Index" };
  const tickerOptions = [...suggestions].filter(Boolean).sort().map((symbol) => `<option value="${escapeHtml(symbol)}">${escapeHtml(indexNames[symbol] || "Stock / ETF")}</option>`);
  datalist.innerHTML = [...currencyOptions, ...tickerOptions].join("");
}

async function renderMarketChart() {
  const input = document.querySelector("#market-symbol-input");
  const chartState = document.querySelector("#market-chart-state");
  const requestedSymbol = String(input?.value || "USD").trim().toUpperCase();
  const symbol = resolveMarketSymbol(requestedSymbol);
  if (!symbol) return;
  if (input) input.value = requestedSymbol;

  const requestId = ++marketRequestId;
  chartState.textContent = `Loading ${symbol}…`;
  chartState.classList.add("visible");

  try {
    const isCurrency = marketCurrencies.has(symbol);
    const isFrankfurterPair = ["USEU", "EUUS"].includes(symbol);
    const isFredIndex = [".INX", ".DJI", ".IXIC"].includes(requestedSymbol);
    const result = isFredIndex
      ? await api.getIndexHistory({ symbol: requestedSymbol, ...currencyParamsForRange(marketRange) })
      : isFrankfurterPair
      ? await api.getFrankfurterHistory({ ticker: symbol, ...currencyParamsForRange(marketRange) })
      : isCurrency
        ? await api.getCurrencyHistory({ code: symbol, ...currencyParamsForRange(marketRange) })
        : await api.getMarketTimeSeries({ symbol, ...marketParamsForRange(marketRange) });
    if (requestId !== marketRequestId) return;
    let values = result.values || [];
    if ((isCurrency || isFrankfurterPair || isFredIndex) && marketRange === "1D") values = values.slice(-2);
    if ((isCurrency || isFrankfurterPair || isFredIndex) && marketRange === "5D") values = values.slice(-5);
    if (!values.length) throw new Error("No prices are available for this period.");

    const currency = result.meta?.currency || "USD";
    const latest = values.at(-1);
    const first = values[0];
    const previous = values.length > 1 ? values.at(-2) : first;
    const changeBase = marketRange === "1D" ? previous.close : first.close;
    const change = latest.close - changeBase;
    const percent = changeBase ? change / changeBase * 100 : 0;
    const positive = change >= 0;
    const rangeLabel = marketRange === "CUSTOM" && marketCustomRange
      ? `${marketCustomRange.startDate}–${marketCustomRange.endDate}`
      : marketRange;

    document.querySelector("#market-symbol-title").textContent = result.meta?.name
      ? `${result.meta.symbol} · ${result.meta.name}`
      : result.meta?.symbol || symbol;
    document.querySelector("#market-last-price").textContent = formatMarketPrice(latest.close, currency);
    const changeElement = document.querySelector("#market-change");
    changeElement.textContent = `${positive ? "+" : ""}${percent.toFixed(2)}% (${positive ? "+" : ""}${change.toFixed(2)}) · ${rangeLabel}`;
    changeElement.classList.toggle("negative", !positive);
    document.querySelector("#market-last-date").textContent = `${latest.datetime} · ${result.meta?.exchange || "Market"}`;
    document.querySelector("#market-meta").textContent = `${result.meta?.type || "Security"} · ${result.meta?.interval || marketParamsForRange(marketRange).interval} · ${result.provider || "Twelve Data"}${result.cached ? " · cached" : ""}`;

    const styles = getComputedStyle(document.documentElement);
    const lineColor = positive ? styles.getPropertyValue("--positive").trim() : styles.getPropertyValue("--danger").trim();
    const gridColor = styles.getPropertyValue("--border").trim();
    const textColor = styles.getPropertyValue("--muted").trim();
    const context = document.querySelector("#market-price-chart").getContext("2d");
    marketPriceChart?.destroy();
    marketPriceChart = new Chart(context, {
      type: "line",
      data: {
        labels: values.map((point) => point.datetime),
        datasets: [{
          data: values.map((point) => point.close),
          borderColor: lineColor,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.22,
          fill: true,
          backgroundColor: (chartContext) => {
            const chart = chartContext.chart;
            if (!chart.chartArea) return "transparent";
            const gradient = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
            gradient.addColorStop(0, `${lineColor}55`);
            gradient.addColorStop(1, `${lineColor}05`);
            return gradient;
          },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        animation: { duration: 550 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => formatMarketPrice(item.parsed.y, currency) } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: 7, maxRotation: 0 } },
          y: { position: "right", grid: { color: gridColor }, ticks: { color: textColor, callback: (value) => Number(value).toLocaleString(window.FinoI18n?.locale || "en") } },
        },
      },
    });
    chartState.classList.remove("visible");
  } catch (error) {
    if (requestId !== marketRequestId) return;
    marketPriceChart?.destroy();
    marketPriceChart = null;
    chartState.textContent = error.message || "Could not load market prices.";
    chartState.classList.add("visible");
  }
}

function setupMarket() {
  populateMarketSymbols();
  api.getMarketCurrencies().then((result) => {
    (result.currencies || []).forEach((currency) => marketCurrencies.set(currency.code, currency.name));
    populateMarketSymbols();
  }).catch((error) => console.warn("Could not load NBU currency list:", window.FinoErrors.diagnostics(error)));
  document.querySelector("#market-symbol-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderMarketChart();
  });
  document.querySelectorAll("[data-market-range]").forEach((button) => {
    button.addEventListener("click", () => {
      marketRange = button.dataset.marketRange;
      document.querySelectorAll("[data-market-range]").forEach((item) => item.classList.toggle("active", item === button));
      renderMarketChart();
    });
  });
  const customForm = document.querySelector("#market-custom-range");
  const fromInput = document.querySelector("#market-date-from");
  const toInput = document.querySelector("#market-date-to");
  if (fromInput && !fromInput.value) fromInput.value = dateDaysAgo(31);
  if (toInput && !toInput.value) toInput.value = new Date().toISOString().slice(0, 10);
  customForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const startDate = fromInput?.value;
    const endDate = toInput?.value;
    if (!startDate || !endDate || startDate > endDate) {
      showNotice("Choose a valid custom date range.");
      return;
    }
    marketCustomRange = { startDate, endDate }; stateStore.setUI({ marketCustomRange });
    marketRange = "CUSTOM";
    document.querySelectorAll("[data-market-range]").forEach((item) => item.classList.remove("active"));
    renderMarketChart();
  });
}

Object.assign(window, { populateMarketSymbols, renderMarketChart, setupMarket });
})();
