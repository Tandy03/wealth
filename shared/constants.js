(function (root, factory) {
  const constants = factory();
  if (typeof module === 'object' && module.exports) module.exports = constants;
  else root.FinoConstants = constants;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
// Business vocabulary; legacy normalization remains tolerant of historical data.
return Object.freeze({
  BASE_CURRENCY: 'UAH',
  CURRENCIES: Object.freeze(['UAH', 'USD', 'EUR']),
  ASSET_TYPES: Object.freeze(['ovdp', 'inzhur_reit', 's1_reit', 'inzhur_miltech', 'etf', 'stock', 'savings', 'novapay', 'deposit', 'crypto_earn']),
  FRACTIONAL_ASSET_TYPES: Object.freeze(['etf', 'stock', 'crypto_earn']),
  PAYMENT_TYPES: Object.freeze(['DIVIDEND', 'COUPON', 'MATURITY']),
  DIVIDEND_RECORD_RULES: Object.freeze(['previous_month_end', 'payment_date']),
  PAYMENT_STATUSES: Object.freeze(['planned', 'received', 'paid']),
  SYNC_ACTIONS: Object.freeze(['sync', 'upload', 'download', 'backup', 'reconnect']),
  QUANTITY_EPSILON: 1e-10,
  DAYS_PER_YEAR: 365,
  MILLISECONDS_PER_DAY: 86400000,
  DEFAULT_BOND_REDEMPTION: 1000,
  INZHUR_ASSETS_URL: 'https://www.inzhur.reit/_api/assets',
  INZHUR_CACHE_TTL_MS: 15 * 60 * 1000,
  ASSET_TYPE_LABELS: Object.freeze({ ovdp: 'OVDP', inzhur_reit: 'Inzhur REIT', s1_reit: 'S1 REIT', inzhur_miltech: 'Inzhur MilTech', etf: 'ETF', stock: 'Stock', savings: 'Savings', novapay: 'NovaPay', deposit: 'Bank deposit', crypto_earn: 'Crypto Earn' }),
  DEFAULT_EXCHANGE_RATES: Object.freeze({ UAH: 1, USD: 45, EUR: 51 }),
  WALLET_CATEGORIES: Object.freeze(['Salary', 'Tithe', 'Utilities', 'Save+invest', 'Groceries + household', 'Fuel', 'Transport', 'Subscriptions', 'Other', 'Entertainment', 'Gifts', 'Health', 'Children']),
  DEFAULT_INSTRUMENTS: Object.freeze([
    Object.freeze({ name: 'Inzhur', type: 'Broker' }),
    Object.freeze({ name: 'Універ', type: 'Broker' }),
    Object.freeze({ name: 'Binance', type: 'Crypto exchange' }),
    Object.freeze({ name: 'cash', type: 'Cash' }),
    Object.freeze({ name: 'monobank', type: 'Bank' }),
    Object.freeze({ name: 'Pryvatbank', type: 'Bank' }),
  ]),
});

});

