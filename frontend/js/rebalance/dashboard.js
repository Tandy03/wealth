// Rebalance UI state and charts. Portfolio-finance owns every financial calculation.
(function () {
  const weights = new Map();
  const colorIndexes = new Map();
  const charts = new Map();
  const bound = new WeakSet();
  let snapshot, savedPlan = null, editorSignature = '', notice = '', baseView = null, palette = null;
  let hydrated = false, expected = null, pending = false, timer = null, saving = null, saveError = null, lastPersistence = null;
  const recoveryKey = 'fino-rebalance-draft-v1';
  let inflight = null, restoredScope = null;
  let renderedAccount = null, generation = 0;
  const element = id => document.getElementById(id);
  const t = key => window.FinoI18n.t(key);
  const format = (key, value) => window.FinoI18n.format(key, { value });
  const percent = value => new Intl.NumberFormat(window.FinoI18n.locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100);
  const amount = value => new Intl.NumberFormat(window.FinoI18n.locale, { style: 'currency', currency: 'UAH', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(value);
  const setText = (id, value) => { const node = element(id); if (node && node.textContent !== value) node.textContent = value; };
  const signature = plan => window.FinoStateModel.rebalanceSignature(plan);
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const account = () => window.mobileApi?.localAccountScope || 'desktop';
  const scope = () => JSON.stringify([window.location.origin, account(),
    (snapshot.data.assets || []).map(asset => asset.id).sort()]);
  function cacheDraft() {
    try { sessionStorage.setItem(recoveryKey, JSON.stringify({ scope: scope(), expected, plan: draft(), inflight })); }
    catch (_) { /* Local API/journal persistence remains available without browser storage. */ }
  }
  function clearDraft() {
    try { if (JSON.parse(sessionStorage.getItem(recoveryKey) || 'null')?.scope === scope()) sessionStorage.removeItem(recoveryKey); }
    catch (_) { /* Recovery is optional when browser storage is unavailable. */ }
  }
  function restoreDraft() {
    if (pending || saving || restoredScope === scope()) return;
    try {
      const recovery = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
      if (!recovery || recovery.scope !== scope()) return;
      window.FinoStateModel.validateJson(recovery);
      window.FinoStateModel.validateRebalance(recovery.plan);
      const actual = signature(snapshot.data.rebalance);
      const acceptable = [recovery.expected, recovery.plan, ...(recovery.inflight ? [recovery.inflight] : [])].some(plan => signature(plan) === actual);
      restoredScope = scope();
      if (signature(recovery.plan) === actual) { clearDraft(); return; }
      // Recover the editor, but never overwrite a different saved plan implicitly.
      hydrate(recovery.plan); expected = copy(acceptable ? snapshot.data.rebalance : recovery.expected); pending = true;
      if (!acceptable) saveError = new window.FinoErrors.ConflictError();
      else { timer = setTimeout(() => { timer = null; void flush(); }, 200); }
    } catch (_) { /* An invalid recovery draft cannot enter the shared document. */ }
  }
  function hydrate(plan) {
    expected = copy(plan); hydrated = true;
    weights.clear();
    for (const [id, share] of Object.entries(plan?.targets || {})) weights.set(id, String(share));
    snapshot.rebalanceDrafts = copy(plan?.plannedAssets || []);
    snapshot.rebalanceExcluded = [...(plan?.excluded || [])];
    baseView = null; savedPlan = null;
  }
  function draft() {
    const current = view();
    return { targets: Object.fromEntries(current.groups.map(group => {
      const raw = weights.get(group.id) ?? '0';
      const valid = !window.FinoRebalanceModel.inspect([raw]).invalid[0];
      return [group.id, valid ? Number(raw) : expected?.targets[group.id] || 0];
    })), plannedAssets: copy(snapshot.rebalanceDrafts || []), excluded: [...(snapshot.rebalanceExcluded || [])] };
  }
  function renderPersistence() {
    const conflict = saveError?.status === 409 || saveError?.category === 'conflict';
    setText('rebalance-save-status', t(saveError ? conflict ? 'The rebalance plan changed. Reload before editing it again.' : 'Could not save the rebalance plan. Try again.'
      : pending ? 'Saving rebalance plan…' : lastPersistence?.savedRemotely ? 'Rebalance plan saved to Drive.' : 'Rebalance plan saved locally. Drive sync has its own status.'));
    const status = element('rebalance-save-status');
    const requestId = window.FinoErrors.safeRequestId(saveError?.requestId);
    if (status && requestId) status.textContent += ' ' + format('Request ID: {value}', requestId);
    if (status) { status.hidden = !pending && !lastPersistence && !expected; status.dataset.state = saveError ? 'error' : pending ? 'pending' : 'saved'; }
    const retry = element('rebalance-save-retry');
    if (retry) { retry.hidden = !saveError || conflict; retry.onclick = () => { saveError = null; void flush(); }; }
    const reload = element('rebalance-save-reload');
    if (reload) { reload.hidden = !conflict; reload.onclick = async () => {
      try {
        const result = await stateStore.loadData(() => api.getData());
        if (!result.applied) return;
        const data = stateStore.getData();
        pending = false; saveError = null; lastPersistence = null;
        clearDraft();
        snapshot = stateStore.getState(); hydrate(data.rebalance); update(false); renderPersistence();
      } catch (error) { saveError = error; renderPersistence(); }
    }; }
  }
  function changed() {
    if (renderedAccount !== account()) return;
    pending = true; saveError = null;
    cacheDraft();
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, 200);
    renderPersistence();
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (renderedAccount !== account()) return Promise.resolve();
    if (saving) return saving;
    const writeGeneration = generation;
    saving = (async () => {
      while (pending && !saveError) {
        const plan = draft();
        if (signature(plan) === signature(expected)) { pending = false; clearDraft(); break; }
        try {
          inflight = copy(plan); cacheDraft();
          const saved = await stateStore.saveRebalance({ plan, expected: copy(expected) }, request => api.saveRebalance(request));
          if (writeGeneration !== generation || renderedAccount !== account()) return;
          expected = copy(saved.value); lastPersistence = saved.persistence;
          pending = signature(draft()) !== signature(plan);
          inflight = null;
          if (pending) cacheDraft(); else clearDraft();
        } catch (error) {
          if (writeGeneration !== generation || renderedAccount !== account()) return;
          saveError = error;
        }
      }
    })().finally(() => {
      saving = null; renderPersistence();
      if (writeGeneration !== generation && pending && !saveError) timer = setTimeout(() => { timer = null; void flush(); }, 0);
    });
    renderPersistence();
    return saving;
  }
  function color(groupId) {
    if (!colorIndexes.has(groupId)) colorIndexes.set(groupId, colorIndexes.size);
    const index = colorIndexes.get(groupId);
    return index < 8 ? palette.assets[index] || `hsl(${index * 137.508 % 360} 62% 55%)`
      : `hsl(${index * 137.508 % 360} 62% ${palette.lightness || '55%'})`;
  }
  function view() {
    if (!baseView) {
      const services = createRenderServices(snapshot);
      const groups = services.getRebalanceGroups().map(group => ({ ...group, value: group.assets.reduce((sum, asset) =>
        sum + services.toUAH(services.getAvailableQuantity(asset.id) * services.getCurrentPrice(asset), asset.currency), 0) }));
      baseView = { services, groups, totalValue: groups.reduce((sum, group) => sum + group.value, 0) };
    }
    const { services, groups, totalValue } = baseView;
    const visible = groups.filter(group => !(snapshot.rebalanceExcluded || []).includes(group.id));
    for (const group of visible) if (!weights.has(group.id)) weights.set(group.id, '0');
    const allocation = window.FinoRebalanceModel.inspect(visible.map(group => weights.get(group.id)));
    const basis = JSON.stringify([groups.map(group => [group.id, group.assets.map(asset => asset.id), group.value]), visible.map(group => [group.id, weights.get(group.id)])]);
    return { services, groups, visible, allocation, totalValue, basis };
  }
  function clearStalePlan(current) {
    if (savedPlan && savedPlan.basis !== current.basis) savedPlan = null;
  }
  function renderEditor(current, editingId) {
    const container = element('rebalance-targets');
    const signature = JSON.stringify(current.visible.map(group => [group.id, group.label]));
    const rebuilt = signature !== editorSignature || !container.children.length;
    if (rebuilt) {
      editorSignature = signature;
      container.innerHTML = current.visible.length ? current.visible.map((group, index) => `
        <div class="rebalance-field" data-rebalance-row="${escapeHtml(group.id)}">
          <div class="rebalance-asset-name"><i class="rebalance-color" aria-hidden="true"></i><span translate="no" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span></div>
          <span class="rebalance-current-share" data-label="${escapeHtml(t('Current %'))}" translate="no"></span>
          <input class="rebalance-slider" type="range" min="0" max="100" step="0.1" data-rebalance-slider="${escapeHtml(group.id)}" aria-describedby="rebalance-allocation-status" aria-label="${escapeHtml(format('Adjust target share for {value}', group.label))}" />
          <div class="rebalance-number"><input id="rebalance-weight-${index}" type="number" min="0" max="100" step="0.1" required data-rebalance-group="${escapeHtml(group.id)}" aria-describedby="rebalance-allocation-status" aria-label="${escapeHtml(format('Target share for {value}', group.label))}" /><span aria-hidden="true">%</span></div>
          <button type="button" class="icon-btn" data-remove-rebalance="${escapeHtml(group.id)}" aria-label="${escapeHtml(format('Remove {value}', group.label))}" title="${escapeHtml(t('Remove from this plan only'))}">×</button>
        </div>`).join('') : `<p class="rebalance-empty">${escapeHtml(t('Add an asset to calculate a rebalance.'))}</p>`;
    }
    container.querySelectorAll('[data-rebalance-row]').forEach(row => {
      if (editingId && !rebuilt && row.dataset.rebalanceRow !== editingId) return;
      const group = current.visible.find(item => item.id === row.dataset.rebalanceRow);
      const raw = weights.get(group.id);
      const index = current.visible.indexOf(group);
      row.querySelector('.rebalance-color').style.backgroundColor = color(group.id);
      row.querySelector('.rebalance-current-share').textContent = percent(current.totalValue ? group.value / current.totalValue * 100 : 0);
      const input = row.querySelector('[data-rebalance-group]');
      if (input.value !== raw) input.value = raw;
      input.setCustomValidity(current.allocation.invalid[index] ? t('Enter target shares from 0 to 100 in steps of 0.1.') : '');
      input.setAttribute('aria-invalid', String(current.allocation.invalid[index]));
      const slider = row.querySelector('[data-rebalance-slider]');
      slider.value = current.allocation.invalid[index] ? '0' : raw;
      slider.style.setProperty('--rebalance-progress', slider.value + '%');
      slider.style.setProperty('--rebalance-row-color', color(group.id));
      slider.setAttribute('aria-valuetext', percent(Number(slider.value)));
    });
    bind(container);
  }
  function updateChart(id, data, options, animate) {
    const canvas = element(id);
    if (!canvas || typeof Chart === 'undefined') return;
    const signature = JSON.stringify([data, options.backgroundColor, options.borderColor, options.color, options.contextKey]);
    let entry = charts.get(id);
    if (entry && entry.signature === signature) return;
    const config = {
      type: 'doughnut', data,
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '74%',
        animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 220 },
        plugins: {
          legend: { display: false },
          tooltip: { finoSkipLabels: true, backgroundColor: options.backgroundColor, borderColor: options.borderColor, borderWidth: 1,
            titleColor: options.color, bodyColor: options.color,
            callbacks: { title: items => items[0]?.label || '', label: context => options.label(context.dataIndex) } },
        },
      },
    };
    if (!entry) {
      entry = { chart: new Chart(canvas, config), signature };
      charts.set(id, entry);
    } else {
      entry.chart.data = data;
      Object.assign(entry.chart.options.plugins.tooltip, config.options.plugins.tooltip);
      entry.chart.update(animate ? undefined : 'none');
      entry.signature = signature;
    }
  }
  function renderCharts(current, animate) {
    const theme = palette.theme;
    element('rebalance-chart-status').hidden = typeof Chart !== 'undefined';
    const labels = current.groups.map(group => group.label);
    const colors = current.groups.map(group => color(group.id));
    const currentValues = current.groups.map(group => group.value);
    const targetValues = current.groups.map(group => {
      const index = current.visible.findIndex(item => item.id === group.id);
      return index < 0 || current.allocation.invalid[index] ? 0 : current.allocation.values[index];
    });
    const missing = Math.max(0, 100 - current.allocation.total);
    const targetLabels = [...labels], targetColors = [...colors], targets = [...targetValues];
    if (missing > 0) { targetLabels.push(t('Unallocated')); targetColors.push(theme.borderColor); targets.push(missing); }
    const dataset = (chartLabels, values, chartColors) => ({ finoSkipLabels: true, labels: chartLabels, datasets: [{ data: values, backgroundColor: chartColors, borderColor: theme.backgroundColor, borderWidth: 2, hoverOffset: 5 }] });
    updateChart('rebalance-current-chart', dataset(labels, currentValues, colors), { ...theme, label: index =>
      `${percent(current.totalValue ? currentValues[index] / current.totalValue * 100 : 0)} · ${amount(currentValues[index])}` }, animate);
    const canProject = savedPlan && current.groups.every(group => group.value <= 0 || current.visible.some(item => item.id === group.id) && Number(weights.get(group.id)) > 0);
    const projectedTotal = canProject ? current.totalValue + savedPlan.plan.totalToInvest : null;
    updateChart('rebalance-target-chart', dataset(targetLabels, targets, targetColors), { ...theme, contextKey: projectedTotal, label: index =>
      percent(targets[index]) + (projectedTotal != null && index < labels.length ? ' · ' + amount(projectedTotal * targets[index] / 100) : '') }, animate);
    setText('rebalance-current-center', amount(current.totalValue));
    setText('rebalance-target-center', percent(current.allocation.total));
    element('rebalance-current-empty').hidden = current.totalValue > 0;
    element('rebalance-target-empty').hidden = current.allocation.total > 0;
    element('rebalance-current-chart').parentElement.classList.toggle('is-empty', !(current.totalValue > 0));
    element('rebalance-legend').innerHTML = `<div class="rebalance-legend-head"><span>${escapeHtml(t('Asset'))}</span><span>${escapeHtml(t('Current %'))}</span><span>${escapeHtml(t('Target %'))}</span></div>` + current.groups.map((group, index) => `
      <div class="rebalance-legend-row"><span class="rebalance-asset-name"><i class="rebalance-color" style="background:${escapeHtml(colors[index])}" aria-hidden="true"></i><span translate="no">${escapeHtml(group.label)}</span></span><span translate="no">${percent(current.totalValue ? group.value / current.totalValue * 100 : 0)}</span><span translate="no">${percent(targetValues[index])}</span></div>`).join('') + (missing > 0 ? `<div class="rebalance-legend-row"><span class="rebalance-asset-name"><i class="rebalance-color" style="background:${escapeHtml(theme.borderColor)}" aria-hidden="true"></i><span>${escapeHtml(t('Unallocated'))}</span></span><span>—</span><span translate="no">${percent(missing)}</span></div>` : '');
  }
  function renderResults(current) {
    const container = element('rebalance-results');
    setText('rebalance-invest-value', savedPlan ? amount(savedPlan.plan.totalToInvest) : '—');
    if (!savedPlan) {
      const text = t('Set your targets, then calculate the investment plan.');
      if (container.dataset.resultKey !== 'empty') container.innerHTML = `<p class="rebalance-empty">${escapeHtml(text)}</p>`;
      container.dataset.resultKey = 'empty';
      return;
    }
    const resultKey = current.basis + JSON.stringify(current.visible.map(group => color(group.id)));
    if (container.dataset.resultKey === resultKey) return;
    const { recommendations, totalToInvest } = savedPlan.plan;
    const hasZeroHolding = recommendations.some(item => item.percent === 0 && item.value > 0);
    container.innerHTML = `<div class="rebalance-table-wrap"><table class="rebalance-result-table"><thead><tr>${['Asset', 'Action', 'Amount', 'Target %'].map(label => `<th>${escapeHtml(t(label))}</th>`).join('')}</tr></thead><tbody>` + recommendations.map(item => {
      const buy = item.difference > 0.005;
      return `<tr><td><span class="rebalance-asset-name"><i class="rebalance-color" style="background:${escapeHtml(color(item.groupId))}" aria-hidden="true"></i><span translate="no">${escapeHtml(item.group?.label || t('Asset'))}</span></span></td><td data-label="${escapeHtml(t('Action'))}"><span class="rebalance-action ${buy ? 'is-buy' : 'is-hold'}">${escapeHtml(t(buy ? 'Buy' : 'Hold'))}</span></td><td data-label="${escapeHtml(t('Amount'))}" translate="no">${buy ? escapeHtml(amount(item.difference)) : '—'}</td><td data-label="${escapeHtml(t('Target %'))}" translate="no">${percent(item.percent)}</td></tr>`;
    }).join('') + `</tbody></table></div><div class="rebalance-result-total"><span>${escapeHtml(t('Total to invest'))}</span><strong translate="no">${escapeHtml(amount(totalToInvest))}</strong></div>` + (hasZeroHolding ? `<p class="rebalance-method">${escapeHtml(t('Holdings with a 0% target remain because this plan does not sell.'))}</p>` : '');
    container.dataset.resultKey = resultKey;
  }
  function update(animate = true, editingId = null) {
    if (!snapshot || !element('rebalance-targets')) return;
    const styles = getComputedStyle(element('rebalance-section'));
    palette = { theme: { backgroundColor: styles.getPropertyValue('--surface').trim(), borderColor: styles.getPropertyValue('--border').trim(), color: styles.getPropertyValue('--text').trim() },
      assets: Array.from({ length: 8 }, (_, index) => styles.getPropertyValue('--rebalance-asset-' + (index + 1)).trim()), lightness: styles.getPropertyValue('--rebalance-color-lightness').trim() };
    const current = view();
    clearStalePlan(current);
    renderEditor(current, editingId);
    setText('rebalance-portfolio-value', amount(current.totalValue));
    setText('rebalance-asset-count', new Intl.NumberFormat(window.FinoI18n.locale).format(current.visible.length));
    setText('rebalance-total', percent(current.allocation.total));
    const invalid = current.allocation.invalid.some(Boolean);
    const status = element('rebalance-allocation-status');
    const message = notice || (invalid ? t('Enter target shares from 0 to 100 in steps of 0.1.') : current.allocation.valid ? t('Allocation is ready to calculate.')
      : format(current.allocation.total > 100 ? '{value} over the target allocation.' : '{value} remains unallocated.', percent(Math.abs(100 - current.allocation.total))));
    status.textContent = message;
    status.dataset.state = invalid || current.allocation.total > 100 ? 'error' : current.allocation.valid ? 'success' : 'warning';
    element('rebalance-total').classList.toggle('invalid', !current.allocation.valid);
    element('calculate-rebalance').disabled = !current.allocation.valid;
    element('normalize-rebalance').disabled = !current.visible.length || invalid;
    renderResults(current);
    window.FinoRebalanceCurrencyHover.update(savedPlan ? savedPlan.plan.totalToInvest : null);
    renderCharts(current, animate);
  }
  function render(next = stateStore.getState()) {
    snapshot = next;
    if (renderedAccount !== account()) {
      clearTimeout(timer); timer = null; pending = false; saveError = null; lastPersistence = null;
      hydrated = false; restoredScope = null; inflight = null; generation++; renderedAccount = account();
    }
    if (!hydrated || !pending && !saving && signature(next.data.rebalance) !== signature(expected)) hydrate(next.data.rebalance);
    restoreDraft();
    baseView = null; update(false); renderPersistence();
  }
  function bind(container) {
    if (bound.has(container)) return;
    bound.add(container);
    container.addEventListener('change', () => { if (pending && !saveError) void flush(); });
    container.addEventListener('input', event => {
      const input = event.target;
      const id = input.dataset.rebalanceGroup || input.dataset.rebalanceSlider;
      if (!id) return;
      weights.set(id, input.value); notice = ''; update(true, id);
      changed();
    });
    container.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-rebalance]');
      if (!button) return;
      const id = button.dataset.removeRebalance;
      const state = stateStore.getState();
      if (!id.startsWith('planned-') && !state.rebalanceExcluded.includes(id)) state.rebalanceExcluded.push(id);
      state.rebalanceDrafts = state.rebalanceDrafts.filter(item => item.id !== id);
      weights.delete(id); notice = ''; render(state);
      changed();
      (container.querySelector('[data-rebalance-group]') || element('add-rebalance-asset')).focus();
    });
  }
  function normalize() {
    if (!snapshot) return;
    const current = view();
    try {
      const values = window.FinoRebalanceModel.normalize(current.visible.map(group => weights.get(group.id)));
      current.visible.forEach((group, index) => weights.set(group.id, String(values[index])));
      notice = '';
      changed();
    } catch (error) { notice = t(error.message); }
    update();
  }
  function calculate(event) {
    event?.preventDefault();
    if (!snapshot) return;
    const current = view();
    if (!current.allocation.valid) { notice = t('Target shares must total 100% and stay between 0 and 100.'); update(); return; }
    element('rebalance-form').setAttribute('aria-busy', 'true');
    try {
      const plan = current.services.calculateRebalancePlan(current.visible.map((group, index) => ({ groupId: group.id, percent: current.allocation.values[index] })));
      savedPlan = { basis: current.basis, plan }; notice = '';
    } catch (error) { savedPlan = null; notice = t(error.message); }
    finally { element('rebalance-form').setAttribute('aria-busy', 'false'); }
    update();
  }
  window.addEventListener('pagehide', () => { if (pending && !saveError) void flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending && !saveError) void flush(); });
  window.FinoRebalanceDashboard = { render, update, bind, normalize, calculate, changed, flush };
})();
