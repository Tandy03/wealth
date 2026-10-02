const { normalizeNumber } = require('../../utils/values');
const { getNbuCurrencyHistory } = require('../nbu/exchangeHistory');
const URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json';
function createSource({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let cache = { updatedAt: 0, exchangeDate: null, rates: null };
  async function readRates() {
    const response = await fetchImpl(URL, { headers: { Accept: 'application/json', 'User-Agent': 'Wealth-Dashboard/1.0' } });
    if (!response.ok) throw new Error(`NBU API returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('NBU API returned an invalid payload.');
    return payload;
  }
  async function getExchangeRates() {
    const fresh = cache.rates && now() - cache.updatedAt < 60 * 60 * 1000;
    try {
      if (!fresh) {
        const payload = await readRates();
        const usd = payload.find(item => String(item.cc).toUpperCase() === 'USD');
        const eur = payload.find(item => String(item.cc).toUpperCase() === 'EUR');
        if (!usd || !eur || normalizeNumber(usd.rate) <= 0 || normalizeNumber(eur.rate) <= 0) throw new Error('USD or EUR rate is missing from the NBU response.');
        cache = { updatedAt: now(), exchangeDate: usd.exchangedate || eur.exchangedate || null, rates: { UAH: 1, USD: normalizeNumber(usd.rate), EUR: normalizeNumber(eur.rate) } };
      }
      return { ...cache, cached: fresh, source: 'NBU' };
    } catch (error) {
      if (cache.rates) return { ...cache, cached: true, stale: true, source: 'NBU' };
      throw error;
    }
  }
  async function getCurrencies() {
    const excluded = new Set(['UAH', 'XAU', 'XAG', 'XPT', 'XPD']);
    return { source: 'NBU', currencies: (await readRates()).filter(item => /^[A-Z]{3}$/.test(String(item.cc || '')) && !excluded.has(String(item.cc).toUpperCase())).map(item => ({ code: String(item.cc).toUpperCase(), name: item.txt, rate: normalizeNumber(item.rate), exchangeDate: item.exchangedate })) };
  }
  return { getExchangeRates, getCurrencies, getCurrencyHistory: getNbuCurrencyHistory };
}
module.exports = { createSource, getNbuCurrencyHistory };
