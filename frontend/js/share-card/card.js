
const implementation = (function () {
  const labels = { value: 'Portfolio value', invested: 'Total invested', profit: 'Profit', return: 'Return', xirr: 'XIRR', realized: 'Realized result', unrealized: 'Unrealized result', count: 'Asset count' };
  const periodLabels = { current: 'Current', '1m': '1 month', '3m': '3 months', '6m': '6 months', '1y': '1 year', ytd: 'Year to date', all: 'All time', custom: 'Custom period' };
  const xml = text => String(text).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
  const color = (value, fallback) => /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%]+\))$/i.test(String(value).trim()) ? String(value).trim() : fallback;
  function themeTokens(document, theme) {
    const tokens = {}, palette = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
      for (const rule of rules || []) {
        const selector = rule.selectorText || '';
        const selected = selector.includes(`:root[data-theme="${theme}"]`);
        if (selector !== ':root' && !selected && !['#rebalance-section, #analytics-section', '#rebalance-section,\n#analytics-section'].includes(selector)) continue;
        for (const key of ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'positive', 'danger']) {
          const value = rule.style.getPropertyValue('--' + key); if (value) tokens[key] = value.trim();
        }
        for (let i = 0; i < 8; i++) { const value = rule.style.getPropertyValue('--rebalance-asset-' + (i + 1)); if (value) palette[i] = value.trim(); }
        const lightness = rule.style.getPropertyValue('--rebalance-color-lightness'); if (lightness) tokens.lightness = lightness.trim();
      }
    }
    return { ...tokens, palette };
  }
  function render({ report, selected, locale, t, typeLabels, tokens = {} }) {
    const c = { bg: '#0b0d11', surface: '#11141a', 'surface-2': '#171b22', border: '#262c35', text: '#f2f4f7', muted: '#8b93a1', accent: '#7c8cff', positive: '#49c58b', danger: '#ff6874' };
    for (const key of Object.keys(c)) c[key] = color(tokens[key], c[key]);
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="${xml(t('My portfolio'))}" font-family="Arial, sans-serif">`,
      `<rect width="1080" height="1080" fill="${c.bg}"/><rect x="24" y="24" width="1032" height="1032" rx="38" fill="${c.surface}" stroke="${c.border}"/>`];
    const text = (value, x, y, size, fill = c.text, weight = 400, width = null) => {
      const string = String(value), fitted = width ? Math.min(size, width / Math.max(1, string.length * .63)) : size;
      out.push(`<text x="${x}" y="${y}" font-size="${fitted}" font-weight="${weight}" fill="${fill}">${xml(string)}</text>`);
    };
    const date = value => value ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value + 'T12:00:00')) : '';
    if (selected.branding) {
      out.push(`<path d="M68 91v-16m12 16V64m12 27V53" stroke="${c.accent}" stroke-width="7" stroke-linecap="round"/>`);
      text('fino', 110, 91, 33, c.text, 700);
    }
    text(t('My portfolio'), 64, 148, 39, c.text, 700, 920);
    text(t(periodLabels[report.period]), 64, 187, 23, c.muted, 400, 360);
    text(report.from ? date(report.from) + ' — ' + date(report.to) : date(report.to), 445, 187, 23, c.muted, 400, 570);
    const ids = Object.keys(labels).filter(id => selected[id]);
    const allocation = selected.allocation;
    const columns = ids.length === 1 ? 1 : 2, rows = Math.ceil(ids.length / columns);
    const available = allocation ? 386 : 648, height = Math.min(150, available / Math.max(1, rows));
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const percent = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ids.forEach((id, i) => {
      const x = 64 + i % columns * 488, y = 220 + Math.floor(i / columns) * height, width = columns === 1 ? 952 : 464;
      out.push(`<rect x="${x}" y="${y}" width="${width}" height="${height - 12}" rx="18" fill="${c['surface-2']}"/>`);
      text(t(labels[id]), x + 22, y + 29, 20, c.muted, 400, width - 44);
      const value = report.metrics[id];
      const formatted = value == null || !Number.isFinite(value) ? t('Unavailable') : id === 'return' || id === 'xirr' ? (id === 'xirr' && report.xirrEstimated ? '≈ ' : '') + percent.format(value * (id === 'xirr' ? 100 : 1)) + '%' : id === 'count' ? number.format(value) : new Intl.NumberFormat(locale, { style: 'currency', currency: report.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2, notation: Math.abs(value) >= 1e15 ? 'scientific' : 'standard' }).format(value);
      text(formatted, x + 22, y + Math.min(83, height - 26), height > 105 ? 47 : 36, ['profit', 'return', 'realized', 'unrealized'].includes(id) && value < 0 ? c.danger : c.text, 700, width - 44);
    });
    if (allocation) {
      const y = Math.max(385, 220 + rows * height + 28);
      const chartHeight = 908 - y, radius = Math.min(132, chartHeight / 2 - 22), cx = 226, cy = y + chartHeight / 2 + 12;
      text(t('Asset allocation'), 64, y, 24, c.text, 700);
      const total = report.allocation.reduce((sum, item) => sum + item.amount, 0);
      out.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${c['surface-2']}" stroke-width="42"/>`);
      let offset = 0;
      const circumference = 2 * Math.PI * radius, legendColumns = report.allocation.length > 9 ? 2 : 1;
      const legendRows = Math.ceil(report.allocation.length / legendColumns), lineHeight = Math.min(38, (chartHeight - 10) / Math.max(1, legendRows));
      report.allocation.forEach((item, i) => {
        const share = total > 0 ? item.amount / total : 0;
        const fill = i < 8 ? color(tokens.palette?.[i], [c.accent, c.positive, c.danger, c.muted][i % 4]) : color(`hsl(${i * 137.508 % 360} 62% ${tokens.lightness || '60%'})`, c.accent);
        out.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${fill}" stroke-width="42" stroke-dasharray="${Math.max(0, share * circumference - 3)} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`);
        offset += share * circumference;
        const column = Math.floor(i / Math.max(1, legendRows)), x = 428 + column * 294, ly = y + 44 + i % Math.max(1, legendRows) * lineHeight;
        out.push(`<circle cx="${x}" cy="${ly - 6}" r="6" fill="${fill}"/>`);
        const label = typeLabels[item.type] || t('Other');
        text(t(label), x + 18, ly, 20, c.text, 400, legendColumns === 2 ? 172 : 392);
        text(new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(share * 100) + '%', legendColumns === 2 ? x + 202 : 927, ly, 18, c.muted, 400, 76);
      });
      text(total > 0 ? report.allocationPartial ? '≈' : '100%' : '—', cx - 58, cy + 14, 38, c.text, 700);
      if (!total) text(t('No allocation data'), 428, cy, 24, c.muted, 400, 560);
    }
    if (!ids.length && !allocation) text(t('Choose metrics to include'), 64, 380, 32, c.muted, 400, 920);
    const notes = [];
    if (report.historical && ['profit', 'return', 'xirr'].some(id => selected[id])) notes.push(t('Period Profit, Return and XIRR are unavailable.'));
    if (selected.xirr && report.annualized) notes.push(t('XIRR is annualized; dated cash flows.'));
    if (allocation && report.allocationPartial) notes.push(t('Allocation may be incomplete or estimated.'));
    const lines = [''];
    for (const word of notes.join(' ').split(/\s+/)) {
      if (lines.at(-1).length + word.length > 102) lines.push('');
      lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
    }
    lines.forEach((line, i) => text(line, 64, 946 + i * 18, 15, c.muted, 400, 952));
    text(t('Amounts use valuation-date FX.'), 64, 1008, 17, c.muted, 400, 780);
    text(report.currency + (selected.branding ? ' · fino' : ''), 858, 1008, 20, c.muted, 400, 160);
    out.push('</svg>');
    return out.join('');
  }
  return { labels, periodLabels, themeTokens, render };
})();
export default implementation;
export const { labels, periodLabels, render, themeTokens } = implementation;
