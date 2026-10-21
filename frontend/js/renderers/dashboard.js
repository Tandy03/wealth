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

function setReturnBenchmarkHover(element, portfolioReturn, state = stateStore.getState()) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  const label = document.querySelector("#stat-roi-label");
  const note = card.querySelector('#stat-roi-note') || card.querySelector('small');
  const t = window.FinoI18n.t;
  if (portfolioReturn !== undefined) element.dataset.portfolioReturn = portfolioReturn == null ? "Unavailable" : `${portfolioReturn.toFixed(2)}%`;
  element.dataset.benchmarkReturn = state.sp500Benchmark == null ? window.FinoI18n.t(state.sp500BenchmarkStatus === 'loading' ? 'Loading…' : 'Unavailable') : `${state.sp500Benchmark >= 0 ? "+" : ""}${state.sp500Benchmark.toFixed(2)}%`;
  card.classList.add("currency-hover-card");
  card.title = state.sp500BenchmarkStart && state.sp500BenchmarkEnd ? `S&P 500 · ${state.sp500BenchmarkStart} — ${state.sp500BenchmarkEnd}` : "Compare with S&P 500";
  element.dataset.portfolioNote = t('All-time simple return at report-date FX; unavailable with incomplete valuation.');
  const benchmarkNote = state.sp500Benchmark != null
    ? state.sp500BenchmarkStatus === 'unavailable' ? 'S&P 500: last loaded result; the data provider is currently unavailable.' : 'S&P 500 price change over the investment period; dividends are excluded.'
    : state.sp500BenchmarkStatus === 'loading' ? 'Loading S&P 500 history…'
      : state.sp500BenchmarkErrorCode === 'INDEX_HISTORY_NOT_FOUND' ? 'No S&P 500 quotes are available for the investment period.'
        : ['FRED_NOT_CONFIGURED', 'NOT_CONFIGURED'].includes(state.sp500BenchmarkErrorCode) ? 'S&P 500 data access is not configured.'
          : 'S&P 500 history is temporarily unavailable from the data provider.';
  element.dataset.benchmarkNote = t(benchmarkNote);
  card.tabIndex = 0;
  if (!card.dataset.benchmarkHoverBound) {
    card.dataset.benchmarkHoverBound = "true";
    const showBenchmark = () => {
      card.dataset.benchmarkView = 'benchmark';
      if (label) label.textContent = "S&P 500";
      element.textContent = element.dataset.benchmarkReturn;
      if (note) note.textContent = element.dataset.benchmarkNote;
    };
    const showPortfolioReturn = () => {
      card.dataset.benchmarkView = 'portfolio';
      if (label) label.textContent = "Return";
      element.textContent = element.dataset.portfolioReturn;
      if (note) note.textContent = element.dataset.portfolioNote;
    };
    card.addEventListener("mouseenter", showBenchmark);
    card.addEventListener("mouseleave", showPortfolioReturn);
    card.addEventListener("focus", showBenchmark);
    card.addEventListener("blur", showPortfolioReturn);
  }
  if (label) label.textContent = card.dataset.benchmarkView === 'benchmark' ? 'S&P 500' : 'Return';
  element.textContent = card.dataset.benchmarkView === 'benchmark' ? element.dataset.benchmarkReturn : element.dataset.portfolioReturn;
  if (note) note.textContent = card.dataset.benchmarkView === 'benchmark' ? element.dataset.benchmarkNote : element.dataset.portfolioNote;
}

function setXirrValue(element, xirr) {
  if (!element) return;
  const card = element.closest(".stat-card") || element;
  const details = xirr && typeof xirr === 'object' ? xirr : null;
  const value = details ? details.value : xirr;
  element.textContent = value == null ? window.FinoI18n.t(details?.incomplete ? 'Incomplete' : 'Unavailable') : `${details?.estimated ? '≈ ' : ''}${(value * 100).toFixed(2)}%`;
  const note = document.querySelector('#stat-xirr-note');
  if (note && details) {
    const v = details.valuation, dates = v.rows.map(row => row.quoteDate).filter(Boolean).sort();
    note.textContent = window.FinoI18n.format('Unvalued: {missing}; stale: {stale}; undated: {undated}. Fresh quote coverage by cost basis: {share}.', { missing: v.unpricedCount, stale: v.staleCount, undated: v.undatedCount, share: v.freshQuoteShare == null ? '—' : v.freshQuoteShare.toFixed(1) + '%' })
      + ' ' + window.FinoI18n.format('Valuation: {date}. Quote dates: {from} — {to}. Sources: {sources}.', { date: v.asOf, from: dates[0] || '—', to: dates.at(-1) || '—', sources: [...new Set(v.rows.map(row => window.FinoI18n.t(row.source)))].join(', ') || '—' })
      + ' ' + window.FinoI18n.format('Operation-date FX; estimated conversions: {estimated}; missing FX: {missing}.', { estimated: details.estimatedFx + v.estimatedFx, missing: details.missingFx + v.missingFx })
      + (details.missingHistory || details.missingAmounts || details.missingDates ? ' ' + window.FinoI18n.t('Incomplete cash-flow history.') : '')
      + ' ' + window.FinoI18n.t('Fresh means a recorded quote no older than 7 days. Missing prices are not replaced with purchase prices.');
  }
  card.classList.remove("currency-hover-card");
  card.removeAttribute("title");
  card.removeAttribute("tabindex");
}

function renderReinvestmentForecast(state = stateStore.getState(), services = createRenderServices(state)) {
  const amount = document.querySelector('#stat-reinvestment');
  if (!amount) return;
  const t = window.FinoI18n.t, f = window.FinoI18n.format;
  const forecast = FinoDashboardAnalytics.reinvestmentForecast({ data: stateStore.selectData(state), market: services, asOf: getDateString() });
  const set = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
  const approximate = forecast.estimated || forecast.incomplete;
  const currency = (value, estimated = approximate) => Number.isFinite(value) ? (estimated ? '≈ ' : '') + money(value) : '—';
  const badIncome = forecast.incomeComplete === false;
  const badCapital = forecast.capitalComplete === false;
  set('reinvestment-income', currency(badIncome ? null : forecast.income, forecast.estimatedIncomeShare > 0));
  set('stat-average-monthly-profit', f('Average regular income per month: {amount}', { amount: currency(badIncome ? null : forecast.averageMonthlyIncome) }));
  set('reinvestment-average-capital', currency(badCapital ? null : forecast.averageCapital, forecast.estimatedCapitalShare > 0));
  set('reinvestment-current-capital', currency(forecast.currentCapitalComplete === false ? null : forecast.currentCapital, forecast.currentCapitalEstimated));
  set('reinvestment-annual-yield', Number.isFinite(forecast.annualYield) ? (approximate ? '≈ ' : '') + (forecast.annualYield * 100).toFixed(2) + '%' : '—');
  set('reinvestment-required-capital', currency(forecast.requiredCapital));
  set('reinvestment-target', currency(forecast.targetMonthlyIncome, Boolean(forecast.targetFx?.estimated)));
  set('reinvestment-observation', f('Observation: {from} — {to}; {days} calendar days.', { from: forecast.firstDate || '—', to: forecast.lastDate || '—', days: forecast.observationDays || 0 }) + ' ' + f('Funded capital days: {days}.', { days: forecast.fundedDays || 0 }));
  set('reinvestment-range', forecast.range ? f('Additional-capital scenario range: {min} — {max}', { min: currency(forecast.range[0]), max: currency(forecast.range[1]) }) : '');
  set('reinvestment-excess', forecast.additionalInvestment === 0 ? f('Target covered in the base scenario. Observed average above target: {observed}/month; modelled current excess: {current}/month.', { observed: currency(forecast.observedExcess), current: currency(forecast.currentMonthlyExcess) }) : '');
  const reasons = {
    data: 'Incomplete data: scenario amounts are hidden.',
    history: 'Insufficient history: at least 90 days of completed investments are required.',
    'income-history': 'No confirmed regular-income history. Missing receipts do not prove zero yield.',
    capital: 'The average invested capital is unavailable or zero.',
    return: 'Recorded regular-income yield is not positive; required capital cannot be estimated.',
  };
  const historyNote = forecast.insufficientHistory ? f('Insufficient history: {days} of the required 90 funded days are available.', { days: forecast.fundedDays || 0 }) : '';
  const incomeMessages = {
    missing: 'No confirmed regular-income receipts in the observation period. Income-based metrics are unavailable.',
    invalid: 'Regular-income receipt data is invalid or cannot be valued. Income-based metrics are unavailable.',
    'zero-total': 'Recorded regular-income receipts sum to zero. Income-based estimates are unavailable; review the records.',
  };
  const incomeMessage = incomeMessages[forecast.incomeState];
  const status = incomeMessage ? t(incomeMessage) + (forecast.reason === 'data' ? ' ' + t(reasons.data) : '')
    : forecast.reason === 'history' ? '' : t(reasons[forecast.reason] || (forecast.preliminary ? 'Preliminary scenario: less than 365 days of history.' : 'Assumption scenarios, not forecasts or probabilities.'));
  set('reinvestment-status', status + (historyNote ? (status ? ' ' : '') + historyNote : ''));
  set('reinvestment-quality', f('History gaps: {history}; missing FX: {fx}; invalid records: {invalid}; ambiguous receipts: {ambiguous}. Fallback share: capital-days {capital}%, income {income}%.', {
    history: forecast.issues.history || 0, fx: forecast.issues.missingFx || 0, invalid: forecast.issues.invalidRecords || 0, ambiguous: forecast.issues.ambiguousReceipts || 0,
    capital: ((forecast.fallbackCapitalShare || 0) * 100).toFixed(1), income: ((forecast.fallbackIncomeShare || 0) * 100).toFixed(1),
  }) + (forecast.targetUnavailable ? ' ' + t('The target USD rate is missing, undated or older than 7 days.') : ''));
  amount.textContent = currency(forecast.additionalInvestment);
  amount.dataset.valueUah = amount.textContent;
  amount.dataset.valueUsd = Number.isFinite(forecast.additionalInvestment) && forecast.targetFx?.rate > 0 ? '$' + currencyFormatter.format(forecast.additionalInvestment / forecast.targetFx.rate) : '—';
  const scenarios = document.querySelector('#reinvestment-scenarios');
  scenarios?.replaceChildren();
  const names = { conservative: 'Conservative', base: 'Base', optimistic: 'Optimistic' };
  for (const scenario of forecast.scenarios) {
    const row = document.createElement('li'), title = document.createElement('b');
    title.textContent = t(names[scenario.name]) + ' · ' + (scenario.multiplier * 100) + '%'; row.append(title);
    for (const text of [f('Annual regular-income yield: {yield}', { yield: (scenario.annualYield * 100).toFixed(2) + '%' }),
      f('Required capital: {amount}', { amount: currency(scenario.requiredCapital) }),
      f('Additional capital: {amount}', { amount: currency(scenario.additionalInvestment) }),
      scenario.targetMet ? t('The current capital covers the target under this assumption.') : f('Current capital falls short of the target by {amount}/month.', { amount: currency(scenario.shortfall) })]) {
      const line = document.createElement('span'); line.textContent = text; row.append(line);
    }
    scenarios?.append(row);
  }
  const fx = forecast.targetFx;
  set('reinvestment-fx', fx ? f('Target FX: 1 USD = {rate} UAH; date: {date}; source: {source}.', { rate: fx.rate ?? '—', date: fx.date || t('Date unavailable'), source: t(fx.source || 'Unknown') }) + (fx.estimated ? ' ' + t('Estimated FX.') : '') : '');
  const fxList = document.querySelector('#reinvestment-fx-usage'); fxList?.replaceChildren();
  for (const item of forecast.fxUsage) {
    const row = document.createElement('li');
    row.textContent = `${item.currency}/UAH · ${t(item.method === 'operation-date' ? 'Historical FX' : 'Report-date FX')} · ${item.minRate == null ? '—' : item.minRate === item.maxRate ? item.minRate : item.minRate + ' — ' + item.maxRate} · ${item.from || t('Date unavailable')} — ${item.to || '—'} · ${t(item.source)}${item.estimated ? ' · ' + t('Estimated FX.') : ''}`;
    fxList?.append(row);
  }
  const receipts = document.querySelector('#reinvestment-receipts'); receipts?.replaceChildren();
  set('reinvestment-receipt-count', f('Included receipts: {count}. Showing the latest 20; full history is in Transactions.', { count: forecast.receipts.length }));
  for (const receipt of forecast.receipts.slice(0, 20)) {
    const row = document.createElement('li'), fx = receipt.fx;
    row.setAttribute('translate', 'no');
    row.textContent = `${receipt.date} · ${receipt.assetName} · ${t(receipt.type === 'DIVIDEND' ? 'Dividend' : 'Coupon')} · ${money(receipt.originalAmount, receipt.currency)} → ${currency(receipt.amount, fx.estimated)} · FX ${fx.rate ?? '—'} · ${fx.date || t('Date unavailable')} · ${t(fx.source)}`;
    receipts?.append(row);
  }
}

function renderDashboard(state = stateStore.getState()) {
  const services = createRenderServices(state);
  const { toUAH, convertCurrency, getAvailableQuantity, getCurrentPrice } = services;
  const valuation = services.valuation(), report = services.calculateProfit();
  const observations = services.cashEvents(valuation.asOf);
  const invested = valuation.costBasis, portfolioValue = valuation.knownValue;
  const incompleteRealized = report.missingFx > 0 || report.missingAmounts > 0 || report.missingDates > 0;
  const realized = incompleteRealized ? null : report.totalProfit;
  const totalProfit = realized === null || valuation.unpricedCount ? null : realized + valuation.unrealized;
  const roiBase = invested + report.invested;
  const showResult = (element, amount, sign = false) => {
    if (!element) return;
    if (amount === null) {
      const unavailable = window.FinoI18n.t('Unavailable');
      element.textContent = unavailable; element.dataset.valueUah = unavailable; element.dataset.valueUsd = unavailable;
    } else {
      setDashboardCurrencyHover(element, amount);
      if (sign && amount > 0) { element.dataset.valueUah = '+' + element.dataset.valueUah; element.dataset.valueUsd = '+' + element.dataset.valueUsd; element.textContent = element.dataset.valueUah; }
    }
    element.classList.toggle('result-positive', sign && amount > 0); element.classList.toggle('result-negative', sign && amount < 0);
  };
  showResult(document.querySelector('#stat-invested'), valuation.missingFx ? null : invested);
  showResult(document.querySelector('#stat-value'), valuation.rows.length && valuation.rows.every(row => row.value === null) ? null : portfolioValue);
  const unrealizedElement = document.querySelector('#stat-unrealized');
  if (unrealizedElement && valuation.rows.length && valuation.rows.every(row => row.value === null)) {
    const text = window.FinoI18n.t('No quote available'); unrealizedElement.textContent = text; unrealizedElement.dataset.valueUah = text; unrealizedElement.dataset.valueUsd = text;
  } else showResult(unrealizedElement, valuation.unrealized, true);
  showResult(document.querySelector('#stat-realized'), realized, true);
  showResult(document.querySelector('#stat-profit'), totalProfit);
  const note = document.querySelector('#stat-unrealized-note');
  if (note) note.textContent = window.FinoI18n.t('Open quoted positions only; received income is excluded.') + (valuation.unpricedCount ? ` ${valuation.unpricedCount} ${window.FinoI18n.t('unquoted positions are excluded.')}` : '');
  const currencies = [...new Set([...(stateStore.selectAssets(state) || []).map(asset => asset.currency || 'UAH'), ...observations.flows.map(event => event.currency)])];
  const fx = currencies.map(currency => services.rateInfo(currency, valuation.asOf));
  const estimated = fx.some(info => info.estimated), dates = fx.filter(info => info.source !== 'UAH').map(info => info.date).filter(Boolean).sort();
  const method = window.FinoI18n.format('Report-date FX: {date}. {quality}', { date: dates[0] || valuation.asOf, quality: window.FinoI18n.t(estimated ? 'Estimated FX.' : 'Recorded FX.') });
  for (const id of ['stat-invested-method', 'stat-realized-method', 'stat-profit-method']) { const element = document.getElementById(id); if (element) element.textContent = method; }
  const valueNote = document.querySelector('#stat-value-note');
  if (valueNote) valueNote.textContent = window.FinoI18n.format('Quoted value only; excluded positions: {count}.', { count: valuation.unpricedCount });
  setReturnBenchmarkHover(document.querySelector('#stat-roi'), totalProfit !== null && roiBase > 0 && !valuation.missingFx ? totalProfit / roiBase * 100 : null, state);
  setXirrValue(document.querySelector('#stat-return'), services.calculatePortfolioXirrDetails(valuation, observations));
  renderReinvestmentForecast(state, services);

  const assetsContainer = document.querySelector("#dashboard-assets");

  if (assetsContainer) {
    const activeAssets = stateStore.selectAssets(state).filter(
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
                                    <span translate="no">${escapeHtml(asset.name)}</span>
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

  renderUpcomingPayments(state);
  bindDashboardHoldings(assetsContainer);
}

function renderUpcomingPayments(state = stateStore.getState()) {
  const { groupPaymentEvents } = createRenderServices(state);
  const container = document.querySelector("#dashboard-payments");

  if (!container) {
    return;
  }

  const today = getDateString(new Date());

  const payments = groupPaymentEvents((stateStore.selectPayments(state) || [])
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
                                <span translate="no">${escapeHtml(payment.title)}</span>
                            </div>

                            <div class="payment-meta">
                                ${formatDate(payment.date)}
                                ·
                                ${escapeHtml(paymentTypeLabel(payment.type))}
                            </div>

                        </div>

                        <div class="payment-amount">
                            ${money(payment.amount, payment.currency)}
                        </div>

                    </div>
                `,
    )
    .join("");

  bindUpcomingPaymentActions(container, payments);

}
