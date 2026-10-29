
const implementation = (function () {
  function createController({ store, model, document, window, i18n, typeLabels, escapeHtml, read, actions, getChart, convert }) {
    let chart = null, scope = null, syncStatus = null, last = null, initialScope = false, priceChartStyle = 'real';
    const formatters = new Map(); let cachedModel = null;
    const formatter = (key, create) => { if (!formatters.has(key)) formatters.set(key, create()); return formatters.get(key); };
    const root = () => document.querySelector('#asset-detail-section');
    const t = text => i18n.t(text);
    const e = value => escapeHtml(value == null ? '' : String(value));
    const n = value => value === null || value === undefined ? t('No data') : formatter('number:' + i18n.locale, () => new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 8 })).format(value);
    const percent = value => formatter('percent:' + i18n.locale, () => new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 2 })).format(value) + '%';
    const money = (value, currency) => {
      if (value == null) return t('No data');
      try { return formatter(i18n.locale + ':' + currency, () => new Intl.NumberFormat(i18n.locale, { style: 'currency', currency, maximumFractionDigits: 2 })).format(value); }
      catch (_) { return n(value) + ' ' + currency; }
    };
    const date = value => { const parsed = new Date(String(value || '').slice(0, 10) + 'T12:00:00'); return Number.isFinite(parsed.getTime()) ? formatter('date:' + i18n.locale, () => new Intl.DateTimeFormat(i18n.locale)).format(parsed) : t('No data'); };
    function detailFor(snapshot) {
      const id = snapshot.assetPage?.selectedId, day = new Date().toDateString();
      if (cachedModel?.data !== store.selectData(snapshot) || cachedModel?.id !== id || cachedModel?.day !== day || cachedModel?.marketRevision !== snapshot.marketRevision) cachedModel = { data: store.selectData(snapshot), id, day, marketRevision: snapshot.marketRevision, value: model.createGroupModel(store.selectData(snapshot), id, { convert }) };
      return cachedModel.value;
    }
    const signed = (value, currency) => value == null ? t('No data') : (value > 0 ? '+' : '') + money(value, currency);
    const tone = value => value == null || value === 0 ? '' : value > 0 ? 'result-positive' : 'result-negative';
    const page = () => store.getState().assetPage;
    function destroyChart() { chart?.destroy(); chart = null; }
    function patch(changes) { store.setUI({ assetPage: { ...page(), ...changes } }); render(store.getState(), true); }
    function showSection(section) {
      if (section === 'asset-detail') {
        const investments = document.querySelector('#investments-app'), wallet = document.querySelector('#wallet-app');
        if (investments) investments.hidden = false;
        if (wallet) wallet.hidden = true;
      }
      document.querySelectorAll('#investments-app .page-section').forEach(item => item.classList.toggle('active', item.id === section + '-section'));
      const title = document.querySelector('#page-title'); if (title) title.textContent = section === 'asset-detail' ? t('Asset details') : t(section === 'portfolio' ? 'Portfolio' : 'Dashboard');
    }
    function open(ids, { from, recordHistory = true } = {}) {
      ids = Array.isArray(ids) ? ids : [ids];
      const origin = from || (document.querySelector('#portfolio-section')?.classList.contains('active') ? 'portfolio' : 'dashboard');
      const current = page();
      scope = store.capture().scope;
      initialScope = scope == null && !store.getState().portfolioLoaded;
      store.setUI({ assetPage: { ids: [...ids], selectedId: ids[0], tab: 'overview', filter: 'all', mode: 'price', range: 'all',
        from: '', to: '', origin: current?.active ? current.origin : origin, scrollY: current?.active ? current.scrollY : window.scrollY, active: true } });
      if (!current?.active && recordHistory) window.history?.pushState({ ...window.history.state, finoAsset: true }, '', '#asset/' + encodeURIComponent(ids[0] || ''));
      showSection('asset-detail'); render(store.getState(), true);
      root()?.querySelector('[data-asset-heading]')?.focus({ preventScroll: true });
    }
    function close({ history = true } = {}) {
      const previous = page(); if (!previous?.active) return;
      destroyChart(); last = null; cachedModel = null; syncStatus = null;
      store.setUI({ assetPage: { ...previous, active: false } });
      showSection(previous.origin || 'dashboard');
      if (history && window.history?.state?.finoAsset) window.history.back();
      else if (history && window.location.hash.startsWith('#asset/')) window.history?.replaceState(null, '', window.location.pathname + window.location.search);
      if (typeof window.scrollTo === 'function') window.scrollTo({ top: previous.scrollY || 0 });
    }
    function syncNote() {
      const element = root()?.querySelector('[data-asset-sync]'); if (!element) return;
      const revision = store.getData().sync?.revision;
      const confirmed = syncStatus?.savedRemotely === true && revision != null && syncStatus.localRevision === Number(revision);
      element.textContent = confirmed ? t('Google Drive confirmed this revision.') : syncStatus?.conflict ? t('Saved locally; Google Drive conflict needs review.')
        : syncStatus?.authorizationRequired ? t('Saved locally; Google Drive authorization is required.')
          : t('Local portfolio data. Google Drive upload is not confirmed here.');
    }
    function card(label, value, extra = '', className = '') {
      return `<article class="stat-card ${className}"><span>${e(t(label))}</span><strong>${e(value)}</strong>${extra ? `<small>${e(extra)}</small>` : ''}</article>`;
    }
    function operationsTable(detail, rows) {
      if (!rows.length) return `<p class="empty-state">${e(t('No matching operations.'))}</p>`;
      return `<div class="asset-operation-list">${rows.map(row => `<article class="asset-operation">
        <div class="asset-operation-heading"><strong>${e(t(row.type))}</strong><span>${e(date(row.date))}</span></div>
        ${detail.members?.length > 1 && row.instrumentName ? `<small translate="no">${e(row.instrumentName)}</small>` : ''}
        <dl><div><dt>${e(t('Quantity'))}</dt><dd>${e(n(row.quantity))}</dd></div>
        <div><dt>${e(t('Amount'))}</dt><dd>${e(money(model.finite(row.amount), row.currency))}</dd></div>
        <div><dt>${e(t('Unit price'))}</dt><dd>${e(money(row.price ?? null, row.currency))}</dd></div>
        ${row.type === 'SELL' ? `<div><dt>${e(t('Sold cost basis'))}</dt><dd>${e(money(row.costBasis, row.currency))}</dd></div>
          <div><dt>${e(t('Recorded sale result'))}</dt><dd class="${tone(row.profit)}">${e(signed(row.profit, row.currency))}</dd></div>` : ''}
        <div><dt>${e(t('Status'))}</dt><dd>${e(t(row.status || 'Recorded'))}</dd></div></dl>
        ${row.legacy ? `<small>${e(t('Historical record; companion transaction unavailable.'))}</small>` : ''}</article>`).join('')}</div>`;
    }
    function paymentsList(detail, rows, received = false) {
      if (!rows.length) return `<p class="empty-state">${e(t(received ? 'No received payments.' : 'No planned payments.'))}</p>`;
      return `<div class="asset-payment-list">${rows.map((payment, index) => `<article class="asset-payment" id="asset-payment-${index}-${received ? 'received' : 'planned'}" data-payment-focus="${e(payment.id)}" tabindex="-1">
        <div><strong>${e(t(payment.type))}</strong><span>${e(date(received ? model.paymentDate(payment) : payment.date))}</span></div>
        <strong>${e(money(model.finite(payment.amount), payment.currency || detail.currency))}</strong>
        <small>${e(t(received ? 'Received' : 'Planned — not guaranteed'))}</small>
        ${payment.recordDate ? `<small>${e(t('Record date'))}: ${e(date(payment.recordDate))}</small>` : ''}
        ${!received && payment.amountPerUnit != null ? `<small>${e(t('Quantity is determined by the payment entitlement date.'))}</small>` : ''}
        ${!received && payment.id ? `<button type="button" class="secondary-btn" data-asset-receive="${e((payment.paymentIds || [payment.id]).join(','))}">${e(t('Mark as received'))}</button>` : ''}</article>`).join('')}</div>`;
    }
    function priceChartOptions() {
      const smooth = priceChartStyle === 'smooth';
      return { tension: 0, cubicInterpolationMode: smooth ? 'monotone' : 'default', pointRadius: smooth ? 1.5 : 3, pointHoverRadius: 5, pointHitRadius: 8 };
    }
    function chartMarkup(detail, current) {
      return `<div class="asset-chart-controls">
        <label>${e(t('Chart'))}<select data-asset-chart-mode><option value="price" ${current.mode === 'price' ? 'selected' : ''}>${e(t('Unit price'))}</option><option value="value" ${current.mode === 'value' ? 'selected' : ''}>${e(t('Position value at each date'))}</option></select></label>
        <label>${e(t('Period'))}<select data-asset-chart-range>${[['all','All time'],['1m','1 month'],['3m','3 months'],['1y','1 year'],['custom','Custom']].map(([value, label]) => `<option value="${value}" ${current.range === value ? 'selected' : ''}>${e(t(label))}</option>`).join('')}</select></label>
        <label>${e(t('From'))}<input type="date" data-asset-chart-from value="${e(current.from)}"></label>
        <label>${e(t('To'))}<input type="date" data-asset-chart-to value="${e(current.to)}"></label>
      </div><p class="asset-detail-note">${e(t('Currency'))}: ${e(detail.currency)} · ${e(t('Last recorded quote'))}: ${e(date(detail.history.at(-1)?.date))}<br>
      ${e(t('Sources'))}: <span translate="no">${e([...new Set(detail.history.map(point => point.source || t('Unknown')))].join(', ') || t('No data'))}</span></p>
      ${current.mode === 'price' ? `<div class="asset-price-chart-appearance"><span>${e(t('Chart appearance'))}</span>
        <div class="asset-price-chart-switch" role="group" aria-label="${e(t('Chart appearance'))}" data-no-swipe>
          <button type="button" data-asset-price-style="real" aria-pressed="${priceChartStyle === 'real'}">${e(t('Original'))}</button>
          <button type="button" data-asset-price-style="smooth" aria-pressed="${priceChartStyle === 'smooth'}">${e(t('Smoothed'))}</button>
        </div></div>` : ''}
      <p data-asset-chart-message class="asset-detail-note"></p><div class="asset-detail-chart" hidden><canvas id="asset-detail-chart" aria-label="${e(t('Asset price history'))}" role="img"></canvas></div>
      ${detail.members?.length > 1 ? `<p class="asset-detail-note">${e(t('Grouped history uses each holding’s quantity and last recorded quote on or before that date.'))}</p>` : ''}
      <p class="asset-detail-note">${e(t('Recorded snapshots only; gaps are not interpolated. Historical value uses end-of-day holdings.'))}</p>`;
    }
    function drawChart(detail, snapshot, current) {
      const canvas = root()?.querySelector('#asset-detail-chart'), message = root()?.querySelector('[data-asset-chart-message]');
      if (!canvas || !message) return;
      const invalid = current.from && current.to && current.from > current.to;
      const points = invalid ? [] : model.chartSeries(store.selectData(snapshot), detail, current);
      const Chart = getChart();
      const enoughPoints = points.filter(point => Number.isFinite(point.value)).length >= 2;
      if (invalid || !enoughPoints || current.mode === 'value' && detail.incompleteHistory || !Chart) {
        message.textContent = t(invalid ? 'The start date must not follow the end date.' : current.mode === 'value' && detail.incompleteHistory ? 'Historical quantity is incomplete. Use the unit-price chart.'
          : !enoughPoints ? 'At least two recorded prices are needed for this period.' : 'Charts are unavailable. Recorded quotes remain in the asset data.');
        return;
      }
      canvas.parentElement.hidden = false;
      chart = new Chart(canvas, { type: 'line', data: { labels: points.map(point => date(point.date)), datasets: [{
        label: t(current.mode === 'price' ? 'Unit price' : 'Position value at each date') + ' · ' + detail.currency,
        data: points.map(point => point.value), borderColor: '#8587ff', backgroundColor: '#8587ff22', fill: true, tension: 0, pointRadius: 3, spanGaps: false,
        ...(current.mode === 'price' ? priceChartOptions() : {}),
      }] }, options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => money(item.parsed.y, detail.currency) } } },
        scales: { x: { ticks: { maxTicksLimit: 6 } }, y: { ticks: { callback: value => n(value) } } } } });
    }
    function render(snapshot = store.getState(), force = false) {
      const element = root(), current = snapshot.assetPage;
      if (!element || !current?.active || !element.classList.contains('active')) return;
      if (initialScope && snapshot.portfolioLoaded) { scope = store.capture().scope; initialScope = false; }
      if (scope !== store.capture().scope && snapshot.portfolioLoaded) { close(); return; }
      if (!force && last?.data === store.selectData(snapshot) && last?.page === current && last?.locale === i18n.locale && last?.error === snapshot.portfolioLoadError && last?.marketRevision === snapshot.marketRevision) return;
      if (last && last.data !== store.selectData(snapshot)) syncStatus = null;
      last = { data: store.selectData(snapshot), page: current, locale: i18n.locale, error: snapshot.portfolioLoadError, marketRevision: snapshot.marketRevision };
      destroyChart();
      const back = `<button type="button" class="secondary-btn" data-asset-back>← ${e(t('Back'))}</button>`;
      if (!snapshot.portfolioLoaded) {
        element.innerHTML = `${back}<article class="panel"><h2 data-asset-heading tabindex="-1">${e(t(snapshot.portfolioLoadError ? 'Could not load asset details.' : 'Loading asset details…'))}</h2>${snapshot.portfolioLoadError ? `<p>${e(snapshot.portfolioLoadError.message)}</p><button type="button" class="secondary-btn" data-asset-retry>${e(t('Retry'))}</button>` : ''}</article>`;
        return;
      }
      let detail;
      try { detail = detailFor(snapshot); }
      catch (_) { element.innerHTML = `${back}<article class="panel"><h2 data-asset-heading tabindex="-1">${e(t('Could not load asset details.'))}</h2><p>${e(t('The available history could not be read. Retry loading the portfolio.'))}</p><button type="button" class="secondary-btn" data-asset-retry>${e(t('Retry'))}</button></article>`; return; }
      if (!detail) { element.innerHTML = `${back}<article class="panel"><h2 data-asset-heading tabindex="-1">${e(t('Asset not found.'))}</h2><p>${e(t('The position may have been removed or belongs to another portfolio.'))}</p></article>`; return; }
      const tabs = [['overview','Overview'],['operations','Operations'],['payments','Payments'],['price','Price and value'],['details','Asset details']];
      const totalReceivedNote = t('Received cash includes principal returned at maturity. It is not all profit.');
      const keyCards = card('Remaining quantity', n(detail.holding.remainingQuantity), t('Total acquired') + ': ' + n(detail.holding.purchasedQuantity))
        + card('Remaining cost basis', money(detail.costBasis, detail.currency))
        + card(detail.closed ? 'Closed position value' : 'Market value', money(detail.marketValue, detail.currency), detail.closed ? t('The historical quote is not a live position value.') : t('Remaining quantity × recorded unit price'))
        + card('Unrealized result', signed(detail.unrealized, detail.currency), detail.unrealizedReturn === null ? t('Return unavailable') : percent(detail.unrealizedReturn), tone(detail.unrealized));
      let content;
      if (current.tab === 'overview') content = `<div class="stats-grid asset-detail-stats">${keyCards}</div>
        <article class="panel"><h3>${e(t('Result breakdown'))}</h3><dl class="asset-facts">
        <div><dt>${e(t('Initial purchase quantity'))}</dt><dd>${e(n(detail.initialQuantity))}</dd></div><div><dt>${e(t('Sold quantity'))}</dt><dd>${e(n(detail.soldQuantity))}</dd></div>
        <div><dt>${e(t('Recorded sale result'))}</dt><dd class="${tone(detail.salesResult)}">${e(signed(detail.salesResult, detail.currency))}</dd></div>
        <div><dt>${e(t('Received cash'))}</dt><dd>${e(money(detail.receivedAmount, detail.currency))}</dd></div>
        <div><dt>${e(t('Received investment income'))}</dt><dd>${e(signed(detail.receivedIncome, detail.currency))}</dd></div>
        <div><dt>${e(t('Realized result'))}</dt><dd>${e(signed(detail.realized, detail.currency))}</dd></div></dl>
        <p class="asset-detail-note">${e(t('Realized result = recorded sale profit + received coupons and dividends + maturity proceeds less returned cost basis. Unrealized result is shown separately.'))}</p><p class="asset-detail-note">${e(totalReceivedNote)}</p></article>
        <article class="panel"><h3>${e(t('Price and value'))}</h3>${chartMarkup(detail, current)}<button type="button" class="secondary-btn" data-asset-tab="price">${e(t('Price and value'))}</button></article>
        <article class="panel"><h3>${e(t('Upcoming payments'))}</h3>${detail.planned.slice(0, 3).map(payment => `<button type="button" class="asset-upcoming-link" data-asset-payment-link="${e(payment.id)}">${e(date(payment.date))} · ${e(t(payment.type))} · ${e(money(model.finite(payment.amount), payment.currency || detail.currency))} →</button>`).join('') || `<p class="empty-state">${e(t('No planned payments.'))}</p>`}<small>${e(t('Planned amounts are not guaranteed.'))}</small></article>
        <article class="panel"><h3>${e(t('Latest operations'))}</h3>${operationsTable(detail, detail.operations.slice(0, 3))}<button type="button" class="secondary-btn" data-asset-tab="operations">${e(t('All operations'))}</button></article>
        <article class="panel"><h3>${e(t('Key terms'))}</h3>${detailsMarkup(detail, detail.details.filter(([label]) => ['Maturity date','Annual rate','Early withdrawal','Term in months','Payment method'].includes(label)))}<button type="button" class="secondary-btn" data-asset-tab="details">${e(t('Asset details'))}</button></article>`;
      else if (current.tab === 'operations') {
        const rows = detail.operations.filter(row => current.filter === 'all' || current.filter === 'buy' && row.type === 'BUY' || current.filter === 'sell' && row.type === 'SELL' || current.filter === 'income' && !['BUY','SELL'].includes(row.type));
        content = `<article class="panel"><label>${e(t('Operations'))}<select data-asset-operation-filter>${[['all','All'],['buy','Purchases'],['sell','Sales'],['income','Payments']].map(([value,label]) => `<option value="${value}" ${current.filter === value ? 'selected' : ''}>${e(t(label))}</option>`).join('')}</select></label>
        <p class="asset-detail-note">${e(t('Newest dates first; same-day records retain journal order. Sale results use stored historical values.'))}</p>${operationsTable(detail, rows)}</article>`;
      } else if (current.tab === 'payments') content = `<article class="panel"><h3>${e(t('Received payments'))}</h3>${paymentsList(detail, detail.received, true)}</article><article class="panel"><h3>${e(t('Planned payments'))}</h3><p class="asset-detail-note">${e(t('Amounts may change with holdings, entitlement dates or updated terms. This is not guaranteed income.'))}</p>${paymentsList(detail, detail.planned)}</article>`;
      else if (current.tab === 'price') content = `<article class="panel"><h3>${e(t('Price and value'))}</h3>${chartMarkup(detail, current)}</article>`;
      else content = `<article class="panel"><h3>${e(t('Asset details'))}</h3>${detailsMarkup(detail, detail.details)}${detail.asset.type === 'ovdp' && detail.asset.coupons?.length ? `<h3>${e(t('Coupon terms'))}</h3><dl class="asset-facts">${detail.asset.coupons.map(coupon => `<div><dt>${e(date(coupon.date))}</dt><dd>${e(money(model.finite(coupon.amountPerUnit), detail.currency))} / ${e(t('unit'))}</dd></div>`).join('')}</dl>` : ''}</article>`;
      element.innerHTML = `${back}<header class="asset-detail-header panel"><div><p class="asset-detail-eyebrow">${e(t(typeLabels[detail.asset.type] || detail.asset.type))} · ${e(detail.currency)}</p>
        <h2 data-asset-heading tabindex="-1" translate="no">${e(detail.asset.name || t('Unnamed asset'))}</h2>
        <p translate="no">${e([detail.asset.ticker || detail.asset.symbol, detail.asset.isin, detail.asset.instrumentName].filter(Boolean).join(' · '))}</p>
        <span class="asset-status">${e(t(detail.status))}</span>${detail.closedDate ? `<p>${e(t('Closed on'))}: ${e(date(detail.closedDate))}</p>` : ''}
        <p class="asset-detail-note">${e(t(detail.closed ? 'Last historical price' : 'Current recorded price'))}: ${e(money(detail.price, detail.currency))} · ${e(t('Quote date'))}: ${e(date(detail.quoteDate))}</p></div>
        <div class="asset-detail-actions"><button type="button" class="secondary-btn" data-asset-action="edit">${e(t('Edit'))}</button>
        ${detail.actions.buy ? `<button type="button" class="secondary-btn" data-asset-action="buy">${e(t('Buy'))}</button>` : ''}
        ${detail.actions.sell ? `<button type="button" class="primary-btn" data-asset-action="sell">${e(t('Sell asset'))}</button>` : ''}</div>
        ${detail.members?.length > 1 ? `<p class="asset-detail-note">${e(t('All purchases of this asset are combined.'))} ${e(t('Holdings'))}: ${e(detail.members.length)}${detail.currencies?.length > 1 ? ' · ' + e(t('Display currency')) + ': ' + e(detail.currency) : ''}</p>` : ''}
        <p data-asset-sync class="asset-detail-note"></p></header>
        ${snapshot.portfolioLoadError ? `<p role="alert" class="asset-detail-note">${e(t('Could not refresh. Previously loaded data is shown.'))} <button type="button" class="secondary-btn" data-asset-retry>${e(t('Retry'))}</button></p>` : ''}
        ${detail.mixedCurrency || detail.unlinkedIncome ? `<p class="asset-detail-note" role="note">${e(t('Historical records have missing payment links or different currencies. Subtotals use linked payments in the asset currency; inspect the operation records separately.'))}</p>` : ''}
        <nav class="asset-detail-tabs" aria-label="${e(t('Asset sections'))}">${tabs.map(([value,label]) => `<button type="button" data-asset-tab="${value}" aria-current="${current.tab === value ? 'page' : 'false'}">${e(t(label))}</button>`).join('')}</nav><div class="asset-detail-content">${content}</div>`;
      syncNote(); drawChart(detail, snapshot, current);
      if (current.focusPayment) [...element.querySelectorAll('[data-payment-focus]')].find(item => item.dataset.paymentFocus === current.focusPayment)?.focus({ preventScroll: false });
    }
    function detailsMarkup(detail, rows) {
      return `<dl class="asset-facts">${rows.map(([label, value, format, currency]) => `<div><dt>${e(t(label))}</dt><dd translate="no">${e(format === 'money' ? money(model.finite(value), currency || detail.currency) : format === 'date' ? date(value) : format === 'percent' ? n(model.finite(value)) + '%' : format === 'label' ? t(value) : format === 'boolean' ? t(value === true ? 'Yes' : value === false ? 'No' : String(value)) : value)}</dd></div>`).join('') || `<p>${e(t('No additional terms recorded.'))}</p>`}</dl>`;
    }
    function setup() {
      const element = root(); if (!element) return;
      element.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.hasAttribute('data-asset-price-style')) {
          const style = button.dataset.assetPriceStyle;
          if (page()?.mode !== 'price' || !['real', 'smooth'].includes(style) || style === priceChartStyle) return;
          priceChartStyle = style;
          element.querySelectorAll('[data-asset-price-style]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.assetPriceStyle === style)));
          if (chart) { Object.assign(chart.data.datasets[0], priceChartOptions()); chart.update('none'); }
          return;
        }
        if (button.hasAttribute('data-asset-back')) { close(); return; }
        if (button.hasAttribute('data-asset-retry')) { void read().catch(() => render(store.getState(), true)); return; }
        if (button.dataset.assetTab) { patch({ tab: button.dataset.assetTab, focusPayment: null }); return; }
        if (button.dataset.assetPaymentLink) { patch({ tab: 'payments', focusPayment: button.dataset.assetPaymentLink }); return; }
        if (button.dataset.assetReceive) { void actions.receive(button.dataset.assetReceive.split(','), button); return; }
        const action = button.dataset.assetAction;
        const detail = action ? detailFor(store.getState()) : null;
        if (detail?.actions[action]) actions[action](detail.ids.filter(id => action === 'edit' || detail.members.find(member => member.asset.id === id)?.actions[action]));
      });
      element.addEventListener('change', event => {
        const input = event.target;
        if (input.hasAttribute('data-asset-operation-filter')) { patch({ filter: input.value }); return; }
        if (input.hasAttribute('data-asset-chart-mode')) { patch({ mode: input.value }); return; }
        if (input.hasAttribute('data-asset-chart-from') || input.hasAttribute('data-asset-chart-to')) { patch({ range: 'custom', [input.hasAttribute('data-asset-chart-from') ? 'from' : 'to']: input.value }); return; }
        if (input.hasAttribute('data-asset-chart-range')) {
          const until = new Date(), from = new Date();
          const months = { '1m': 1, '3m': 3, '1y': 12 }[input.value];
          if (months) from.setUTCMonth(from.getUTCMonth() - months);
          patch({ range: input.value, from: months ? from.toISOString().slice(0, 10) : '', to: months ? until.toISOString().slice(0, 10) : '' });
        }
      });
      window.addEventListener('popstate', () => {
        if (page()?.active && !window.location.hash.startsWith('#asset/')) close({ history: false });
        else if (!page()?.active && window.location.hash.startsWith('#asset/')) {
          try { open([decodeURIComponent(window.location.hash.slice(7))], { recordHistory: false }); } catch (_) { open([''], { recordHistory: false }); }
        }
      });
      document.querySelectorAll('#investments-app .nav-item, #open-wallet').forEach(button => button.addEventListener('click', () => {
        if (!page()?.active) return;
        destroyChart(); last = null; cachedModel = null; syncStatus = null; store.setUI({ assetPage: { ...page(), active: false } });
        if (window.location.hash.startsWith('#asset/')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }));
      store.subscribe(({ type, keys, state }) => {
        if (type === 'ui:changed' && (keys.includes('portfolioLoadError') && state.portfolioLoadError || keys.includes('portfolioLoadState') && !state.portfolioLoaded)) render(state, true);
      });
      if (window.location.hash.startsWith('#asset/')) {
        try { open([decodeURIComponent(window.location.hash.slice(7))], { recordHistory: false }); } catch (_) { open([''], { recordHistory: false }); }
      }
    }
    return { setup, open, close, render, setSyncStatus(status) { syncStatus = status; syncNote(); } };
  }
  return { createController };
})();
export default implementation;
export const { createController } = implementation;
