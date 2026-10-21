(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.FinoPortfolioShare) root.FinoPortfolioShare.view = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createController({ window, document, store, feature, services, getRates, getHistoricalRates, today, i18n, typeLabels, escapeHtml }) {
    let overlay = null, previousFocus, stop, platform, report, svg = '', selected, theme, snapshot, rates, cache;
    let generation = 0, invalid = false, busy = false, ready = null, controller = null, context, inert = [];
    const t = key => i18n.t(key), e = escapeHtml;
    const find = selector => overlay?.querySelector(selector);
    const status = text => { const element = find('[data-share-status]'); if (element) element.textContent = text; };
    function controls() {
      for (const button of overlay?.querySelectorAll('[data-share-download], [data-share-send]') || []) button.disabled = busy || invalid || !svg || !platform.supported;
      const share = find('[data-share-send]'); if (share) share.textContent = t(ready ? 'Open share menu' : 'Share');
    }
    function invalidate() { generation++; controller?.abort(); ready = null; platform?.release(); }
    function snapshotNow() {
      snapshot = { ...store.getState() }; rates = getRates(); cache = new Map(); context = store.capture();
    }
    async function update() {
      if (!overlay) return;
      invalidate(); const version = generation;
      const period = find('[data-share-period]').value;
      find('[data-share-dates]').hidden = period !== 'custom';
      const custom = { from: find('[data-share-from]').value, to: find('[data-share-to]').value };
      status(t('Preparing preview…')); svg = ''; invalid = false; controls();
      await Promise.resolve();
      if (!overlay || version !== generation) return;
      try {
        const key = JSON.stringify([period, custom.from, custom.to]);
        report = cache.get(key);
        if (!report) {
          report = feature.createReport({ data: store.selectData(snapshot), services: services(snapshot), readUI: key => store.selectUI(key, snapshot), exchangeRates: rates,
            historicalRates: getHistoricalRates(), period, custom, today: today() });
          if (cache.size >= 12) cache.clear(); cache.set(key, report);
        }
        svg = feature.card.render({ report, selected, locale: i18n.locale, t, typeLabels, tokens: feature.card.themeTokens(document, theme) });
        find('[data-share-preview]').innerHTML = svg;
        find('[data-share-method]').textContent = t(report.historical ? 'Realized result covers the selected dates. Other available values are at period end; period Profit, Return and XIRR are unavailable.' : 'Current metrics use the Dashboard definitions. XIRR is annualized.');
        status(platform.supported ? t(report.empty ? 'No active assets.' : 'Preview ready.') : t('Android file export needs a native bridge. Preview is available; file sharing is not yet verified.'));
      } catch (_) {
        invalid = true; report = null; svg = '';
        find('[data-share-preview]').textContent = t(period === 'custom' ? 'Choose valid dates ending no later than today.' : 'Portfolio share is unavailable.');
        status(t(period === 'custom' ? 'Choose valid dates ending no later than today.' : 'Portfolio share is unavailable.'));
      }
      controls();
    }
    async function exportCard(action) {
      if (!overlay || invalid || busy || !svg || !platform.supported) return;
      const version = generation, name = 'fino-portfolio-' + report.to + '.png';
      busy = true; controls();
      try {
        if (action === 'share' && ready) {
          // No await precedes the platform call: this click owns user activation.
          await platform.share(ready.file);
          if (overlay && version === generation) status(t('Share menu opened.'));
          return;
        }
        controller = new window.AbortController();
        status(t('Preparing PNG…'));
        const blob = await feature.platform.png(svg, { document, window, signal: controller.signal });
        if (!overlay || version !== generation || !store.isCurrent(context)) return;
        if (platform.native) {
          status(t(action === 'share' ? 'Opening share menu…' : 'Choose where to save the PNG.'));
          const result = await (action === 'share' ? platform.share(blob, { name, signal: controller.signal }) : platform.download(blob, name, { signal: controller.signal }));
          if (overlay && version === generation) status(t(result?.cancelled ? 'PNG operation cancelled.' : result?.saved ? 'PNG saved.' : 'Share menu closed. Delivery is not confirmed.'));
          return;
        }
        const file = platform.file(blob, name);
        if (action === 'share' && file && platform.canShare(file)) {
          ready = { blob, file }; status(t('PNG is ready. Tap Open share menu to share.'));
        } else {
          await platform.download(blob, name);
          if (overlay && version === generation) status(t('PNG download started.'));
        }
      } catch (error) {
        const nativeErrors = { NO_SHARE_TARGET: 'No app is available to share PNG files.', SHARE_CACHE_FULL: 'Temporary share storage is full. Try again later.', OPERATION_INTERRUPTED: 'PNG operation interrupted. Please try again.', CONFLICT: 'A PNG operation is already open.' };
        if (overlay && version === generation) status(t(error?.name === 'AbortError' ? 'Sharing cancelled.' : nativeErrors[error?.code] || 'Could not create or share the PNG. Try again.'));
      } finally { busy = false; controller = null; if (overlay) controls(); }
    }
    function keydown(event) {
      if (!overlay) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...overlay.querySelectorAll('button:not(:disabled), select, input')].filter(element => !element.closest('[hidden]'));
      const index = elements.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === elements.length - 1)) { event.preventDefault(); elements[0]?.focus(); }
    }
    function focusin(event) { if (overlay && !overlay.contains(event.target)) find('[data-share-close]')?.focus(); }
    function close() {
      if (!overlay) return;
      invalidate(); stop?.(); stop = null;
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin);
      overlay.remove(); overlay = null; report = null; svg = ''; cache = null; snapshot = null; rates = null;
      for (const [element, value] of inert) element.inert = value; inert = [];
      previousFocus?.focus?.(); previousFocus = null;
    }
    function open() {
      if (overlay) return;
      previousFocus = document.activeElement;
      selected = { return: true, count: true, allocation: true, branding: true };
      theme = document.documentElement.dataset.theme || 'dark'; snapshotNow();
      platform = feature.platform.create({ window, document });
      overlay = document.createElement('div'); overlay.className = 'modal-backdrop open portfolio-share-overlay'; overlay.setAttribute('translate', 'no');
      overlay.innerHTML = `<section class="modal portfolio-share-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-share-title">
        <div class="modal-header"><h2 id="portfolio-share-title">${e(t('Portfolio share card'))}</h2><button type="button" class="icon-btn" data-share-close aria-label="${e(t('Close'))}">×</button></div>
        <div class="portfolio-share-grid"><div class="portfolio-share-settings">
        <label>${e(t('Period'))}<select data-share-period>${feature.periods.map(id => `<option value="${id}">${e(t(feature.card.periodLabels[id]))}</option>`).join('')}</select></label>
        <div data-share-dates hidden><label>${e(t('From'))}<input type="date" data-share-from max="${today()}" lang="${e(i18n.locale)}"></label><label>${e(t('To'))}<input type="date" data-share-to max="${today()}" value="${today()}" lang="${e(i18n.locale)}"></label></div>
        <fieldset><legend>${e(t('Metrics and privacy'))}</legend><p>${e(t('Amounts are off by default. Only selected metrics appear in the PNG.'))}</p>
        ${[...feature.metrics, 'allocation', 'branding'].map(id => `<label class="share-option"><input type="checkbox" data-share-metric="${id}" ${selected[id] ? 'checked' : ''}><span>${e(t(feature.card.labels[id] || (id === 'allocation' ? 'Asset allocation' : 'Fino branding')))}</span></label>`).join('')}</fieldset>
        <label>${e(t('Card theme'))}<select data-share-theme>${['dark', 'light', 'monochromatic', 'analog'].map(id => `<option value="${id}" ${id === theme ? 'selected' : ''}>${e(t(id[0].toUpperCase() + id.slice(1)))}</option>`).join('')}</select></label>
        <p class="portfolio-share-note">${e(t('Generated locally. No portfolio data is uploaded.'))}</p></div>
        <div class="portfolio-share-result"><h3>${e(t('Preview'))}</h3><div data-share-preview class="portfolio-share-preview"></div><p data-share-method class="portfolio-share-note"></p></div></div>
        <div class="portfolio-share-actions"><p data-share-status role="status" aria-live="polite"></p><div><button type="button" class="secondary-btn" data-share-download>${e(t('Download PNG'))}</button><button type="button" class="primary-btn" data-share-send>${e(t('Share'))}</button></div></div></section>`;
      for (const element of document.body.children) if (!['SCRIPT', 'STYLE'].includes(element.tagName)) { inert.push([element, element.inert]); element.inert = true; }
      document.body.append(overlay);
      overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-share-close]')) close(); });
      overlay.addEventListener('change', event => {
        if (event.target.dataset.shareMetric) selected[event.target.dataset.shareMetric] = event.target.checked;
        if (event.target.matches('[data-share-theme]')) theme = event.target.value;
        void update();
      });
      find('[data-share-download]').addEventListener('click', () => { void exportCard('download'); });
      find('[data-share-send]').addEventListener('click', () => { void exportCard('share'); });
      document.addEventListener('keydown', keydown, true); document.addEventListener('focusin', focusin);
      stop = store.subscribe(event => {
        if (!overlay) return;
        if (store.capture().scope !== context.scope) { close(); return; }
        if (event.type === 'data:changed' || event.type === 'ui:changed' && event.keys.includes('marketRevision')) { snapshotNow(); void update(); }
      });
      find('[data-share-close]').focus(); void update();
    }
    return { open, close };
  }
  return { createController };
});
