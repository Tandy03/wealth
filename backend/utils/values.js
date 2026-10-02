const { BASE_CURRENCY, CURRENCIES } = require('../config/constants');
const SUPPORTED_CURRENCIES = new Set(CURRENCIES);
function normalizeCurrency(value) {
    const currency = String(value || BASE_CURRENCY).trim().toUpperCase();
    return SUPPORTED_CURRENCIES.has(currency) ? currency : BASE_CURRENCY;
}
function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
module.exports = { BASE_CURRENCY, normalizeCurrency, normalizeNumber, createId };
