// renderers/dashboard.js
function setDashboardCurrencyHover(element, valueInUah, valueInUsd = null) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  element.dataset.valueUah = money(valueInUah);
  element.dataset.valueUsd = valueInUsd == null
    ? usdMoney(valueInUah)
    : `$${currencyFormatter.format(valueInUsd)}`;
  element.textContent = card.matches(":hover") ? element.dataset.valueUsd : element.dataset.valueUah;
  card.classList.add("currency-hover-card");
  card.removeAttribute("title");
  card.tabIndex = 0;
  if (card.dataset.currencyHoverBound) return;
  card.dataset.currencyHoverBound = "true";
  const showUsd = () => { element.textContent = element.dataset.valueUsd; };
  const showUah = () => { element.textContent = element.dataset.valueUah; };
  card.addEventListener("mouseenter", showUsd);
  card.addEventListener("mouseleave", showUah);
  card.addEventListener("focus", showUsd);
  card.addEventListener("blur", showUah);
}

function setReturnBenchmarkHover(element, portfolioReturn) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  const label = document.querySelector("#stat-roi-label");
  element.dataset.portfolioReturn = portfolioReturn == null ? "Unavailable" : `${portfolioReturn.toFixed(2)}%`;
  element.textContent = element.dataset.portfolioReturn;
  card.classList.add("currency-hover-card");
  card.title = "Compare with S&P 500";
  card.tabIndex = 0;
  if (!card.dataset.benchmarkHoverBound) {
    card.dataset.benchmarkHoverBound = "true";
    const showBenchmark = () => {
      if (label) label.textContent = "S&P 500";
      element.textContent = state.sp500Benchmark == null ? "Unavailable" : `${state.sp500Benchmark >= 0 ? "+" : ""}${state.sp500Benchmark.toFixed(2)}%`;
    };
    const showPortfolioReturn = () => {
      if (label) label.textContent = "Return";
      element.textContent = element.dataset.portfolioReturn;
    };
    card.addEventListener("mouseenter", showBenchmark);
    card.addEventListener("mouseleave", showPortfolioReturn);
    card.addEventListener("focus", showBenchmark);
    card.addEventListener("blur", showPortfolioReturn);
  }
}

function setXirrValue(element, xirr) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  element.textContent = xirr == null ? "Unavailable" : `${(xirr * 100).toFixed(2)}%`;
  card.classList.remove("currency-hover-card");
  card.removeAttribute("title");
  card.removeAttribute("tabindex");
}

function renderReinvestmentForecast(totalProfit, investedCapital) {
  const amountElement = document.querySelector("#stat-reinvestment");
  const averageElement = document.querySelector("#stat-average-monthly-profit");
  if (!amountElement || !averageElement) return;
  const dates = (state.data.transactions || []).map((item) => item.date).filter(Boolean).sort();
  if (!dates.length || investedCapital <= 0) {
    amountElement.dataset.valueUah = "—";
    amountElement.dataset.valueUsd = "—";
    amountElement.textContent = "—";
    averageElement.textContent = "Average monthly profit: insufficient history";
    return;
  }
  const firstDate = new Date(`${dates[0]}T00:00:00`);
  const elapsedMonths = Math.max(1, (Date.now() - firstDate.getTime()) / (30.4375 * 86400000));
  const averageMonthlyProfit = totalProfit / elapsedMonths;
  const monthlyReturnRate = averageMonthlyProfit / investedCapital;
  averageElement.textContent = `Average monthly profit: ${money(averageMonthlyProfit)}`;
  if (monthlyReturnRate <= 0) {
    amountElement.dataset.valueUah = "Insufficient positive return";
    amountElement.dataset.valueUsd = "Insufficient positive return";
    amountElement.textContent = "Insufficient positive return";
    return;
  }
  const targetMonthlyIncome = 1000 * EXCHANGE_RATES.USD;
  const additionalInvestment = Math.max(0, targetMonthlyIncome / monthlyReturnRate - investedCapital);
  setDashboardCurrencyHover(amountElement, additionalInvestment);
}

function renderDashboard() {
  const invested = calculateInvested();
  const portfolioValue = calculatePortfolioValue();

  const investedElement = document.querySelector("#stat-invested");

  const valueElement = document.querySelector("#stat-value");

  const profitElement = document.querySelector("#stat-profit");

  const roiElement = document.querySelector("#stat-roi");

  const returnElement = document.querySelector("#stat-return");

  if (investedElement) {
    setDashboardCurrencyHover(investedElement, invested, calculateInvestedUsd());
  }

  if (valueElement) {
    setDashboardCurrencyHover(valueElement, portfolioValue);
  }

  /*
   * Realized sales profit
   */

  const salesProfit = (state.data.sales || []).reduce(
    (sum, sale) => sum + (sale.type === "savings" ? 0 : toUAH(normalizeNumber(sale.profit), sale.currency)),
    0,
  );

  const priceGrowthProfit = state.data.assets.reduce(
    (sum, asset) => sum + toUAH(getUnrealizedPriceGrowth(asset), asset.currency),
    0,
  );

  /*
   * Received payments
   */

  const receivedPayments = (state.data.payments || [])
    .filter(
      (payment) => payment.status === "received" || payment.status === "paid",
    )
    .reduce(
      (sum, payment) =>
        sum +
        toUAH(normalizeNumber(payment.amount) -
        (payment.type === "MATURITY" ? getMaturityCostBasis(payment.assetId) : 0), payment.currency),
      0,
    );

  const totalProfit = salesProfit + priceGrowthProfit + receivedPayments;

  if (profitElement) {
    setDashboardCurrencyHover(profitElement, totalProfit);
  }

  /*
   * ROI
   */

  const totalCostBasis = (state.data.sales || []).reduce(
    (sum, sale) => sum + (sale.type === "savings" ? 0 : toUAHPurchaseCost(normalizeNumber(sale.costBasis), sale.currency, sale.assetId, getAssetPurchaseDate(sale.assetId, sale.sellDate))),
    0,
  );

  const roiBase = invested + totalCostBasis;
  const roi = roiBase > 0 ? (totalProfit / roiBase) * 100 : 0;
  if (roiElement) {
    setReturnBenchmarkHover(roiElement, roi);
  }
  if (returnElement) {
    const xirr = calculatePortfolioXirr();
    setXirrValue(returnElement, xirr);
  }
  renderReinvestmentForecast(totalProfit, roiBase);

  /*
   * Dashboard assets
   */

  const assetsContainer = document.querySelector("#dashboard-assets");

  if (assetsContainer) {
    const activeAssets = state.data.assets.filter(
      (asset) => getAvailableQuantity(asset.id) > 0,
    );

    if (!activeAssets.length) {
      assetsContainer.className = "asset-list empty-state";

      assetsContainer.textContent = "No active assets.";
    } else {
      assetsContainer.className = "asset-list";

      const groupedAssets = Object.values(activeAssets.reduce((groups, asset) => {
        const key = `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
        groups[key] ||= { ...asset, _assets: [] };
        groups[key]._assets.push(asset);
        return groups;
      }, {}));

      assetsContainer.innerHTML = groupedAssets
        .map((asset) => {
          const available = asset._assets.reduce((sum, holding) => sum + getAvailableQuantity(holding.id), 0);
          const currencies = [...new Set(asset._assets.map((holding) => holding.currency || "UAH"))];
          const displayCurrency = currencies.length === 1 ? currencies[0] : "USD";
          const currentAssetValue = asset._assets.reduce((sum, holding) => sum + convertCurrency(getAvailableQuantity(holding.id) * getCurrentPrice(holding), holding.currency, displayCurrency), 0);
          const currentAssetValueUah = asset._assets.reduce((sum, holding) => sum + toUAH(getAvailableQuantity(holding.id) * getCurrentPrice(holding), holding.currency), 0);
          const assetIds = asset._assets.map((holding) => holding.id);

          return `
                        <div class="asset-row clickable-asset-row" data-asset-group="${escapeHtml(assetIds.join(","))}">

                            <div>
                                <div class="asset-name">
                                    ${escapeHtml(asset.name)}
                                </div>

                                <div class="asset-meta">
                                    ${
                                      typeLabels[asset.type] ||
                                      escapeHtml(asset.type)
                                    }

                                    · ${formatQuantity(available)} units
                                </div>
                            </div>

                            <div class="asset-amount">
                                ${portfolioMoneyWithUahHover(currentAssetValue, displayCurrency, currentAssetValueUah)}
                            </div>

                        </div>
                    `;
        })
        .join("");

      setupPortfolioCurrencyHover(assetsContainer);
    }
  }

  renderUpcomingPayments();
  assetsContainer?.querySelectorAll("[data-asset-group]").forEach((row) => row.addEventListener("click", () => openAssetTransactions(row.dataset.assetGroup.split(","))));
}

function renderUpcomingPayments() {
  const container = document.querySelector("#dashboard-payments");

  if (!container) {
    return;
  }

  const today = getDateString(new Date());

  const payments = groupPaymentEvents((state.data.payments || [])
    .filter(
      (payment) =>
        payment.date >= today &&
        payment.status !== "received" &&
        payment.status !== "paid",
    ))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 8);

  if (!payments.length) {
    container.className = "payment-list empty-state";

    container.textContent = "No upcoming payments.";

    return;
  }

  container.className = "payment-list";

  container.innerHTML = payments
    .map(
      (payment) => `
                    <div
                        class="payment-row"
                        data-payment-ids="${escapeHtml(payment.paymentIds.join(","))}"
                        style="cursor:pointer"
                    >

                        <div>

                            <div class="asset-name">
                                ${escapeHtml(payment.title)}
                            </div>

                            <div class="payment-meta">
                                ${formatDate(payment.date)}
                                ·
                                ${paymentTypeLabel(payment.type)}
                            </div>

                        </div>

                        <div class="payment-amount">
                            ${money(payment.amount, payment.currency)}
                        </div>

                    </div>
                `,
    )
    .join("");

  container.querySelectorAll("[data-payment-ids]").forEach((element) => {
    element.addEventListener("click", () => {
      const payment = payments.find(
        (item) => item.paymentIds.join(",") === element.dataset.paymentIds,
      );

      if (payment) {
        showCalendarEvent(payment);
      }
    });
  });
}
