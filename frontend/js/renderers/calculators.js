// renderers/calculators.js
function renderProfitCalculator(state = stateStore.getState()) {
  const services = createRenderServices(state);
  renderAssetAllocationChart(state); renderPortfolioHistoryChart(state); renderAssetPriceHistoryChart(state);
  const from = document.querySelector('#profit-from')?.value || null, to = document.querySelector('#profit-to')?.value || null;
  const result = services.calculateProfit(from, to), valuation = services.valuation();
  const t = window.FinoI18n.t, f = window.FinoI18n.format;
  const estimated = result.estimatedFx > 0 || result.missingFx > 0 || result.missingAmounts > 0 || result.missingDates > 0;
  for (const [id, key] of [['profit-dividends','dividends'],['profit-coupons','coupons'],['profit-maturity','maturity'],['profit-sales','salesProfit'],['profit-total','totalProfit']]) {
    const element = document.getElementById(id); if (element) element.textContent = result.invalidPeriod ? '—' : !result.eventCount && (result.missingFx || result.missingAmounts || result.missingDates) ? t('Unavailable') : (estimated ? '≈ ' : '') + money(result[key]);
  }
  const method = document.querySelector('#profit-report-method');
  if (method) method.textContent = result.invalidPeriod ? t('Invalid date range.') : f('Realized period: {from} — {to}. Amounts use report-date FX ({date}).', { from: from || t('All time'), to: result.to, date: result.asOf })
    + ' ' + t('Current unrealized result is separate; no period ROI is shown.') + ' ' + t(estimated ? 'Estimated or incomplete conversion.' : 'Recorded FX.')
    + (result.missingDates || result.missingAmounts || result.missingFx ? ' ' + t('Some financial records could not be included.') : '')
    + Object.entries(result.fx).filter(([currency]) => currency !== 'UAH').map(([currency, info]) => ` ${currency}/UAH: ${info.rate ?? '—'} · ${t(info.source)} · ${info.date || '—'}.`).join('');
  const current = document.querySelector('#profit-price-growth');
  if (current) current.textContent = valuation.rows.length && valuation.rows.every(row => row.value === null) ? t('No quote available') : money(valuation.unrealized);
  const note = document.querySelector('#profit-current-note');
  if (note) note.textContent = f('Current snapshot: {date}; unvalued positions excluded: {count}. This is outside the selected period.', { date: valuation.asOf, count: valuation.unpricedCount });
  const renderTable = (tbody, rows) => {
    if (!tbody) return;
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(t('No profit data for selected period.'))}</td></tr>`; return; }
    tbody.innerHTML = rows.map(row => `<tr><td><strong translate="no">${escapeHtml(row.label)}</strong></td>${['invested','dividends','coupons','maturity','salesProfit','totalProfit'].map(key => `<td>${estimated ? '≈ ' : ''}${money(row[key], row.currency)}</td>`).join('')}</tr>`).join('');
  };
  const rows = services.summarizeProfit(result, typeLabels);
  renderTable(document.querySelector('#profit-assets-table'), rows.assetRows); renderTable(document.querySelector('#profit-types-table'), rows.typeRows);
  const concentration = services.concentration(document.querySelector('#concentration-basis')?.value || 'market', valuation);
  const summary = document.querySelector('#concentration-summary');
  if (summary) summary.textContent = f('Largest position: {one}%; top five: {five}%. Basis: {basis}; excluded positions: {excluded}.', { one: concentration.topOneShare.toFixed(1), five: concentration.topFiveShare.toFixed(1), basis: t(concentration.basis === 'cost' ? 'Remaining cost basis' : 'Quoted market value'), excluded: concentration.excludedCount })
    + ' ' + t('Percentages use the selected, valued subset, not an estimate of missing quotes.')
    + (valuation.estimatedFx ? ' ' + t('Estimated FX.') : '');
  const groups = document.querySelector('#concentration-groups');
  if (groups) groups.innerHTML = Object.entries({positions:'Largest positions',issuers:'Issuers',instruments:'Instruments',sectors:'Sectors',currencies:'Currencies'}).map(([key,title]) => `<section><h3>${escapeHtml(t(title))}</h3>${concentration[key].length ? `<ol>${concentration[key].slice(0,10).map(row => `<li><span translate="no">${escapeHtml(row.unknown ? t('Unknown') : row.label)}</span><strong>${row.share.toFixed(1)}%</strong><small>${money(row.value)}</small></li>`).join('')}</ol>` : `<p>${escapeHtml(t('No current holdings to display.'))}</p>`}</section>`).join('');
}

function renderRebalanceCalculator(state = stateStore.getState()) {
  window.FinoRebalanceDashboard.render(state);
}
