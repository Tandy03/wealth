(function (root, factory) {
  const model = factory(typeof module === 'object' && module.exports ? require('./state-model') : root.FinoStateModel);
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FinoMarketModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (state) {
  const finite = value => ['number', 'string'].includes(typeof value) && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
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
      if (details.maturityDate != null) state.validateEntity('Asset', { maturityDate: details.maturityDate });
      if (details.isin != null && typeof details.isin !== 'string') throw new Error('Invalid instrument identity.');
      for (const price of Object.values(details.prices || {})) if (!finite(price)) throw new Error('Invalid Inzhur price.');
      const schedule = details.paymentSchedule || [];
      if (!Array.isArray(schedule)) throw new Error('Invalid Inzhur schedule.');
      for (const payment of schedule) {
        if (!payment || !finite(payment.amount ?? payment.amountPerUnit)) throw new Error('Invalid Inzhur payment amount.');
        state.validateEntity('CalendarNote', { date: payment.date });
      }
      return { id: item.id, slug: item.slug, type: item.type, status: item.status, title: item.title, isin: details.isin || null,
        maturityDate: details.maturityDate || null, prices: details.prices || null, returnRates: details.returnRates || null,
        paymentSchedule: schedule.map(payment => ({ date: payment.date, amount: payment.amount, amountPerUnit: payment.amountPerUnit })) };
    });
  }
  function history(payload) {
    state.validateJson(payload);
    if (!payload || !Array.isArray(payload.values)) throw new Error('Invalid market history.');
    const values = payload.values.filter(point => point && /^\d{4}-\d{2}-\d{2}/.test(point.datetime || '') && ['open', 'high', 'low', 'close'].every(key => finite(point[key]) && Number(point[key]) > 0));
    for (const point of values) state.validateEntity('CalendarNote', { date: point.datetime.slice(0, 10) });
    return { ...payload, values };
  }
  return { nbuRates, inzhurCatalog, history };
});
