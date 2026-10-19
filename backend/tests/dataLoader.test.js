const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../../shared/state-model');
const { createStore } = require('../../frontend/js/state-store');

test('benchmark uses completed investments and legacy purchase dates, sorted in-period positive quotes and preserves a known result during refresh', async () => {
  const data = model.createEmptyState();
  data.assets = [{ id: 'legacy', type: 'stock', purchaseDate: '2026-02-01' }, { id: 'stock', type: 'stock', purchaseDate: '2026-03-01' }, { id: 'cash', type: 'savings', purchaseDate: '2020-01-01' }];
  data.transactions = [{ id: 'buy', assetId: 'stock', type: 'BUY', date: '2026-03-01', quantity: 1, amount: 100 },
    { id: 'pending', assetId: 'stock', type: 'BUY', date: '2020-01-01', status: 'pending', quantity: 1, amount: 100 },
    { id: 'income', assetId: 'stock', type: 'DIVIDEND', date: '2020-01-01', amount: 1 }];
  const store = createStore({ model, initialState: { data } });
  let calls = 0;
  const context = { console, stateStore: store, state: store.getState(), getDateString: () => '2026-10-19',
    api: { getIndexHistory: async query => {
      calls++;
      assert.equal(query.startDate, '2026-02-01'); assert.equal(query.endDate, '2026-10-19');
      if (calls > 1) { assert.ok(Math.abs(store.getState().sp500Benchmark - 10) < 1e-9); }
      return { values: [{ datetime: '2026-10-16', close: 110 }, { datetime: '2026-02-02', close: 100 }, { datetime: '2026-02-31', close: 500 }, { datetime: '2027-01-01', close: 1000 }, { datetime: '2026-01-01', close: 1 }, { datetime: '2026-02-01', close: 0 }] };
    } },
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/data-loader.js'), 'utf8'), context);
  await context.updateSp500Benchmark();
  assert.ok(Math.abs(store.getState().sp500Benchmark - 10) < 1e-9);
  assert.equal(store.getState().sp500BenchmarkStatus, 'ready');
  assert.equal(store.getState().sp500BenchmarkStart, '2026-02-02');
  assert.equal(store.getState().sp500BenchmarkEnd, '2026-10-16');
  await context.updateSp500Benchmark();
  assert.equal(calls, 2);
});

test('local holdings become available even when optional market requests never resolve', async (t) => {
  const data = { assets: [{ id: 'offline-holding' }], transactions: [], wallet: { expenses: [{ date: '2026-01-01', amount: 1, category: 'Savings' }] } };
  let readOptions;
  const store = createStore({ model, initialState: { purchaseExchangeRates: {} } });
  let notifiedCategory;
  store.subscribe(({ type, state }) => { if (type === 'data:changed') notifiedCategory = state.data.wallet.expenses[0].category; });
  const context = {
    console,
    state: store.getState(),
    api: { getData: async options => { readOptions = options; return data; }, getExchangeRates: () => new Promise(() => {}), getCurrencyHistory: () => new Promise(() => {}) },
    stateStore: store,
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
  assert.equal(notifiedCategory, 'Save+invest');
  assert.equal(data.wallet.expenses[0].category, 'Savings', 'The API response must not be mutated.');
});

test('optional market responses for an inactive account cannot change rates, cache or benchmark', async () => {
  let account = 'a', resolveRates, resolveHistory, resolveIndex, cacheWrites = 0;
  const store = createStore({ model, getScope: () => account, initialState: {
    data: { assets: [{ id: 'asset', purchaseDate: '2026-01-01', currency: 'USD' }], transactions: [{ date: '2026-01-01', type: 'BUY' }] },
    purchaseExchangeRates: {},
  } });
  const context = {
    console, stateStore: store, state: store.getState(), normalizeNumber: Number,
    EXCHANGE_RATES: { USD: 40, EUR: 45 }, getDateString: () => '2026-10-19',
    localStorage: { getItem: () => '{}', setItem: () => { cacheWrites++; } },
    api: {
      getData: async () => store.getData(),
      getExchangeRates: () => new Promise(resolve => { resolveRates = resolve; }),
      getCurrencyHistory: () => new Promise(resolve => { resolveHistory = resolve; }),
      getIndexHistory: () => new Promise(resolve => { resolveIndex = resolve; }),
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/data-loader.js'), 'utf8'), context);
  await context.refreshApplicationData();
  const benchmark = context.updateSp500Benchmark();
  account = 'b';
  resolveRates({ rates: { USD: 99, EUR: 99 } });
  resolveHistory({ values: [{ datetime: '2026-01-01', close: 99 }] });
  resolveIndex({ values: [{ close: 100 }, { close: 200 }] });
  await benchmark; await new Promise(setImmediate);
  assert.equal(context.EXCHANGE_RATES.USD, 40);
  assert.equal(context.EXCHANGE_RATES.EUR, 45);
  assert.equal(store.getState().sp500Benchmark, null);
  assert.equal(store.getState().marketRevision, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(store.getState().purchaseExchangeRates)), {});
  assert.equal(cacheWrites, 0);
});
