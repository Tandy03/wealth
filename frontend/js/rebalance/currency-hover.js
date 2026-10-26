// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createRebalanceCurrencyHover({ FinoI18n, api, document }) {
const records = new Map();
  const formatters = new Map();
  let value = null, quote = null, pending = null, failedDay = null, failedAt = 0, sequence = 0;
  const t = key => FinoI18n.t(key);
  function currency(amount, code) {
    const key = FinoI18n.locale + ':' + code;
    if (!formatters.has(key)) formatters.set(key, new Intl.NumberFormat(FinoI18n.locale, {
      style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }));
    return formatters.get(key).format(amount);
  }
  function today() {
    let parts;
    try { parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); }
    catch (_) { parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kiev', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); }
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function render(record) {
    const { host, number, hint } = record;
    const available = value !== null;
    const currentQuote = available && record.active && quote && quote.day === today() ? quote : null;
    const usd = available && record.active && currentQuote;
    number.textContent = !available ? '—' : currency(usd ? value / currentQuote.rate : value, usd ? 'USD' : 'UAH');
    host.classList.toggle('rebalance-currency-hover', available);
    host.classList.toggle('is-usd-active', Boolean(usd));
    hint.hidden = !available || !record.active;
    if (!available) {
      for (const attribute of ['role', 'tabindex', 'aria-pressed', 'aria-describedby', 'aria-label']) host.removeAttribute(attribute);
      return;
    }
    host.setAttribute('role', 'button'); host.tabIndex = 0;
    host.setAttribute('aria-pressed', String(Boolean(usd)));
    host.setAttribute('aria-describedby', hint.id);
    host.setAttribute('aria-label', t('Total to invest') + ': ' + number.textContent + '. ' + t('Hover or tap to view today’s USD equivalent.'));
    if (!record.active) return;
    if (currentQuote) {
      const date = new Intl.DateTimeFormat(FinoI18n.locale, { dateStyle: 'medium' }).format(new Date(currentQuote.day + 'T12:00:00Z'));
      const rate = new Intl.NumberFormat(FinoI18n.locale, { maximumFractionDigits: 4 }).format(currentQuote.rate);
      hint.textContent = FinoI18n.format('NBU rate for {date}: 1 USD = {rate} UAH.', { date, rate });
    } else hint.textContent = t(pending?.day === today() ? 'Loading today’s USD rate…' : 'Today’s USD rate is unavailable.');
  }
  function renderAll() { for (const record of records.values()) if (record.host.isConnected) render(record); }
  function ensureQuote() {
    const day = today();
    if (quote?.day === day || pending?.day === day || failedDay === day && Date.now() - failedAt < 30000) return;
    const request = { day };
    pending = request;
    request.promise = Promise.resolve().then(() => api.getCurrencyHistory({ code: 'USD', startDate: day, endDate: day })).then(result => {
      const point = result?.provider === 'NBU' && result.meta?.currencyCode === 'USD' && Array.isArray(result.values)
        ? result.values.find(item => item.datetime === day && typeof item.close === 'number' && Number.isFinite(item.close) && item.close > 0) : null;
      if (!point) throw new Error('No current-day USD quote.');
      if (today() === day) { quote = { day, rate: point.close }; failedDay = null; }
    }).catch(() => {
      if (today() === day) { failedDay = day; failedAt = Date.now(); }
    }).finally(() => { if (pending === request) pending = null; renderAll(); });
  }
  function show(record, active) {
    if (value === null) return;
    record.active = active;
    if (active) ensureQuote();
    renderAll();
  }
  function bind(number) {
    const host = number.id === 'rebalance-invest-value' ? number.closest('.panel') : number.closest('.rebalance-result-total');
    if (records.has(host)) return records.get(host);
    const hint = document.createElement('span');
    hint.id = 'rebalance-usd-hint-' + (++sequence); hint.className = 'rebalance-currency-tooltip';
    hint.setAttribute('role', 'tooltip'); hint.hidden = true; host.append(hint);
    const record = { host, number, hint, active: false, pinned: false };
    records.set(host, record);
    host.addEventListener('mouseenter', () => show(record, true));
    host.addEventListener('mouseleave', () => { if (!record.pinned) show(record, false); });
    host.addEventListener('focus', () => show(record, true));
    host.addEventListener('blur', () => { record.pinned = false; show(record, false); });
    const toggle = () => { record.pinned = !record.pinned; show(record, record.pinned); };
    host.addEventListener('click', toggle);
    host.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
      if (event.key === 'Escape') { record.pinned = false; show(record, false); }
    });
    return record;
  }
  function update(next) {
    value = typeof next === 'number' && Number.isFinite(next) && next >= 0 ? next : null;
    for (const [host] of records) if (!host.isConnected) records.delete(host);
    document.querySelectorAll('#rebalance-invest-value, #rebalance-results .rebalance-result-total strong').forEach(bind);
    if (value === null) for (const record of records.values()) { record.active = false; record.pinned = false; }
    if ([...records.values()].some(record => record.active) && value !== null) ensureQuote();
    renderAll();
  }
  document.addEventListener('pointerdown', event => {
    for (const record of records.values()) if ((record.active || record.pinned) && !record.host.contains(event.target)) { record.pinned = false; show(record, false); }
  });
  const FinoRebalanceCurrencyHover = { update };
return { FinoRebalanceCurrencyHover };
}
