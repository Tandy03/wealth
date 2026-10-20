(function (root, factory) {
  const model = factory(typeof module === 'object' && module.exports ? require('./state-model') : root.FinoStateModel);
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FinoMarketModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (state) {
  const finite = value => ['number', 'string'].includes(typeof value) && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  const macroTimeoutMs = 25000;
  const policyTimeoutMs = 45000;
  const proxyApiVersion = 1;
  function proxyCompatibility(api, action) {
    // Previously deployed proxies have no metadata. Keep their working endpoints usable.
    if (api === undefined) return { state: 'legacy', apiVersion: null, release: null };
    if (!api || api.apiVersion !== proxyApiVersion || !Number.isInteger(api.minClientVersion) || api.minClientVersion < 1 || api.minClientVersion > proxyApiVersion ||
        typeof api.release !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(api.release) || !Array.isArray(api.capabilities) || !api.capabilities.includes(action)) {
      const error = new Error('The market proxy API is incompatible. Check the deployment before updating the app.');
      error.code = 'PROXY_API_INCOMPATIBLE'; throw error;
    }
    return { state: 'compatible', apiVersion: api.apiVersion, release: api.release };
  }
  const gdpUrl = 'https://stat.gov.ua/sdmx/workspaces/default:integration/registry/sdmx/3.0/data/dataflow/SSSU/DF_ANNUAL_NATIONAL_ACCOUNTS/latest/*?' + new URLSearchParams({
    startPeriod: '2010', 'c[INDICATOR]': 'GDP_CUR_PRC', 'c[PRICE_TYPE]': 'CURR_PRICES,IDX_VOL_PY',
    'c[REGION]': 'UA00000000000000000', 'c[BREAKDOWN_CATEGORY]': '_T', 'c[BREAKDOWN]': '_T', 'c[SECTOR_ECONOMY]': 'S_1', 'c[FREQ]': 'A',
  });
  function parseCsv(text) {
    const rows = []; let row = []; let field = ''; let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
      else if (char === ',' && !quoted) { row.push(field); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[index + 1] === '\n') index++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
      else field += char;
    }
    row.push(field); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  function gdp(text) {
    const rows = parseCsv(text.replace(/^\uFEFF/, ''));
    const headers = rows.shift() || [];
    const objects = rows.map(values => Object.fromEntries(headers.map((key, index) => [key, values[index]])));
    const select = priceType => objects.filter(row => row.INDICATOR === 'GDP_CUR_PRC' && row.PRICE_TYPE === priceType && row.REGION === 'UA00000000000000000' && row.BREAKDOWN_CATEGORY === '_T' && row.BREAKDOWN === '_T' && row.SECTOR_ECONOMY === 'S_1' && row.FREQ === 'A' && /^\d{4}$/.test(row.TIME_PERIOD || '') && finite(row.OBS_VALUE) && Number(row.OBS_VALUE) > 0)
      .map(row => ({ date: row.TIME_PERIOD, value: Number(row.OBS_VALUE) })).sort((a, b) => a.date.localeCompare(b.date));
    const result = { nominal: select('CURR_PRICES'), realIndex: select('IDX_VOL_PY') };
    if (!result.nominal.length || !result.realIndex.length) throw new Error('No valid GDP series returned by the official source.');
    return result;
  }
  function policyRate(payload, { normalized = false } = {}) {
    state.validateJson(payload);
    if (!Array.isArray(payload)) throw new Error('Invalid NBU policy-rate response.');
    const date = row => {
      const value = String(row.dt || row.date || row.startdate || '');
      if (/^\d{8}$/.test(value)) return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
      if (/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(value)) return value.slice(6) + '-' + value.slice(3, 5) + '-' + value.slice(0, 2);
      return value.slice(0, 10);
    };
    const result = payload.filter(row => (normalized ? row?.date : row?.id_api === 'KEY_PolicyRate') && finite(row.value ?? row.rate))
      .map(row => ({ date: date(row), value: Number(row.value ?? row.rate) })).filter(point => state.isDate(point.date)).sort((a, b) => a.date.localeCompare(b.date));
    if (!result.length) throw new Error('No valid NBU policy-rate series returned.');
    return result;
  }
  function nbuRates(payload) {
    state.validateJson(payload);
    if (!Array.isArray(payload) || !payload.length) throw new Error('Invalid NBU response.');
    const result = payload.filter(row => row && /^[A-Z]{3}$/.test(row.cc || '') && finite(row.rate) && Number(row.rate) > 0 && typeof row.txt === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(row.exchangedate || '') && state.validateEntity('CalendarNote', { date: row.exchangedate.split('.').reverse().join('-') }));
    if (!result.length) throw new Error('Invalid NBU rates.');
    return result;
  }
  function inzhurCatalog(payload) {
    state.validateJson(payload);
    if (!Array.isArray(payload)) throw new Error('Invalid Inzhur response.');
    return payload.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid Inzhur asset.');
      for (const key of ['title', 'slug', 'type', 'status']) if (item[key] != null && (typeof item[key] !== 'string' || item[key].length > 500)) throw new Error('Invalid Inzhur asset metadata.');
      const details = item.assetDetails || {};
      const maturityDate = details.maturityDate == null ? null : inzhurDate(details.maturityDate);
      if (details.isin != null && typeof details.isin !== 'string') throw new Error('Invalid instrument identity.');
      for (const price of Object.values(details.prices || {})) if (!finite(price)) throw new Error('Invalid Inzhur price.');
      const schedule = details.paymentSchedule || [];
      if (!Array.isArray(schedule)) throw new Error('Invalid Inzhur schedule.');
      const payments = schedule.map(payment => {
        if (!payment || !finite(payment.amount ?? payment.amountPerUnit)) throw new Error('Invalid Inzhur payment amount.');
        return { date: inzhurDate(payment.date), amount: payment.amount, amountPerUnit: payment.amountPerUnit };
      });
      return { id: item.id, slug: item.slug, type: item.type, status: item.status, title: item.title, isin: details.isin || null,
        maturityDate, prices: details.prices || null, returnRates: details.returnRates || null,
        paymentSchedule: payments };
    });
  }
  function inzhurDate(value) {
    if (typeof value !== 'string' || !state.isDate(value.slice(0, 10))) throw new Error('Invalid Inzhur calendar date.');
    if (state.isDate(value)) return value;
    // The provider represents Ukrainian payment days as UTC timestamps,
    // including 21:00/22:00 on the preceding UTC day. Preserve the Kyiv day.
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid Inzhur timestamp.');
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const date = fields.year + '-' + fields.month + '-' + fields.day;
    if (!state.isDate(date)) throw new Error('Invalid Inzhur calendar date.');
    return date;
  }
  function history(payload) {
    state.validateJson(payload);
    if (!payload || !Array.isArray(payload.values)) throw new Error('Invalid market history.');
    const values = payload.values.filter(point => point && /^\d{4}-\d{2}-\d{2}/.test(point.datetime || '') && ['open', 'high', 'low', 'close'].every(key => finite(point[key]) && Number(point[key]) > 0));
    for (const point of values) state.validateEntity('CalendarNote', { date: point.datetime.slice(0, 10) });
    return { ...payload, values };
  }
  return { nbuRates, inzhurCatalog, history, gdpUrl, macroTimeoutMs, policyTimeoutMs, parseCsv, gdp, policyRate, proxyApiVersion, proxyCompatibility };
});
