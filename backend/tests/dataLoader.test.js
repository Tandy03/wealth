const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('local holdings become available even when optional market requests never resolve', async (t) => {
  const data = { assets: [{ id: 'offline-holding' }], transactions: [] };
  let readOptions, normalized = false;
  const context = {
    console,
    state: { data: null, purchaseExchangeRates: {} },
    api: { getData: async options => { readOptions = options; return data; }, getExchangeRates: () => new Promise(() => {}), getCurrencyHistory: () => new Promise(() => {}) },
    stateStore: { replaceData: value => { context.state.data = value; }, setUI: patch => Object.assign(context.state, patch) },
    normalizeWalletCategoryNames: () => { normalized = true; },
    localStorage: { getItem: () => '{"USD":[{"date":"2026-01-01","rate":40}]}' },
    normalizeNumber: Number,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/data-loader.js'), 'utf8'), context);
  // Exercise the real loader with a dated holding so history really blocks.
  data.assets[0].purchaseDate = '2026-01-01';
  context.getDateString = () => '2026-10-03';
  let timer;
  t.after(() => clearTimeout(timer));
  await Promise.race([context.refreshApplicationData(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Optional network requests blocked local data')), 500); })]);
  assert.equal(readOptions.sync, false);
  assert.equal(context.state.data.assets[0].id, 'offline-holding');
  assert.equal(context.state.purchaseExchangeRates.USD[0].rate, 40);
  assert.equal(normalized, true);
});
