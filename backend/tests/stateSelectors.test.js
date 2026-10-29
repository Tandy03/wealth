const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, createReader } = require('../../frontend/js/state-store');
const model = require('../../shared/state-model');
const values = require('../../frontend/js/analytics/values');
const marketModule = require('../../frontend/js/market-data');
const financeModule = require('../../frontend/js/analytics/portfolio-finance');
const cashflowModule = require('../../frontend/js/cashflow');
const walletModule = require('../../frontend/js/wallet-analytics');
function fixture() {
  const data = model.createEmptyState();
  data.assets.push({ id: 'a', name: 'Stock', type: 'stock', currency: 'UAH', quantity: 2, purchasePrice: 100, currentPrice: 110, purchaseDate: '2025-01-01' });
  data.wallet.expenses.push({ id: 'e', date: '2026-10-01', category: 'Health', amount: 50, currency: 'UAH' });
  return data;
}
function services(readers) {
  const market = marketModule.createService({ ...readers, values, exchangeRates: { UAH: 1, USD: 45 }, historicalRates: { USD: 40 } });
  const finance = financeModule.createService({ ...readers, values, market });
  return { market, finance, cashflow: cashflowModule.createService({ ...readers, values, market, finance }),
    wallet: walletModule.createService({ ...readers, values, categories: ['Health'] }) };
}
test('named financial selectors read live data or an explicit snapshot without copying or silently replacing it', () => {
  const store = createStore({ model, initialState: { data: fixture(), section: 'dashboard' } });
  const snapshot = { ...store.getState() }, before = store.selectData();
  for (const key of ['assets', 'transactions', 'payments', 'sales', 'wallet', 'rebalance', 'calendarNotes', 'priceHistory', 'instruments']) {
    const selector = 'select' + key[0].toUpperCase() + key.slice(1);
    assert.equal(store[selector](), before[key]);
    assert.equal(store[selector](snapshot), before[key]);
  }
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.updateData(draft => { draft.assets[0].quantity = 4; });
  assert.equal(notifications, 1);
  assert.equal(store.selectAssets()[0].quantity, 4);
  assert.equal(store.selectAssets(snapshot)[0].quantity, 2);
  assert.equal(store.selectData(snapshot), before);
  store.setUI({ section: 'portfolio' });
  assert.equal(store.selectUI('section'), 'portfolio');
  assert.equal(store.selectUI('section', snapshot), 'dashboard');
  assert.throws(() => store.selectUI('data'), /financial selector/);
  assert.throws(() => store.selectData(null), TypeError);
});
test('all financial selectors preserve identity and reject mutations under the development/test guard', () => {
  const store = createStore({ model, guard: 'test', initialState: { data: fixture() } });
  const snapshot = store.getState();
  assert.equal(store.selectData(snapshot), store.selectData());
  assert.equal(store.selectAssets(snapshot), store.selectAssets());
  for (const mutate of [
    () => { store.selectAssets()[0].quantity = 500; },
    () => store.selectPayments(snapshot).push({}),
    () => { store.selectWallet().expenses[0].amount = 500; },
    () => { store.selectData(snapshot).wallet = {}; },
  ]) assert.throws(mutate, /store command/);
  assert.equal(store.selectAssets()[0].quantity, 2);
});
test('injected services follow replacements while snapshot services keep their own financial and FX inputs without DOM', () => {
  const store = createStore({ model, guard: 'test', initialState: { data: fixture(), rebalanceDrafts: [], purchaseExchangeRates: {}, exchangeRateDate: '2026-10-20', exchangeRateSource: 'NBU' } });
  const snapshot = { ...store.getState() };
  const live = services({ selectData: store.selectData, selectUI: store.selectUI });
  const fixed = services({ selectData: () => store.selectData(snapshot), selectUI: key => store.selectUI(key, snapshot) });
  const previous = JSON.stringify(store.selectData());
  assert.equal(live.finance.calculateInvested(), 200);
  assert.equal(fixed.wallet.walletCategoryTotal('2026-10', 'Health'), 50);
  const events = fixed.cashflow.getCalendarEvents();
  store.updateData(draft => { draft.assets[0].quantity = 4; draft.wallet.expenses[0].amount = 75; });
  store.setUI({ exchangeRateDate: '2026-10-21' });
  assert.equal(live.finance.calculateInvested(), 400);
  assert.equal(fixed.finance.calculateInvested(), 200);
  assert.equal(live.wallet.walletCategoryTotal('2026-10', 'Health'), 75);
  assert.equal(fixed.wallet.walletCategoryTotal('2026-10', 'Health'), 50);
  assert.equal(live.market.rateInfo('USD', '2026-10-21').date, '2026-10-21');
  assert.equal(fixed.market.rateInfo('USD', '2026-10-21').date, '2026-10-20');
  assert.deepEqual(fixed.cashflow.getCalendarEvents(), events);
  assert.equal(JSON.stringify(store.selectData(snapshot)), previous);
});
test('reader compatibility stays isolated per instance and cannot hide invalid injected dependencies', () => {
  const first = { data: fixture(), section: 'first' }, second = { data: model.createEmptyState(), section: 'second' };
  assert.equal(createReader({ state: first }).selectData(), first.data);
  assert.equal(createReader({ state: second }).selectUI('section'), 'second');
  assert.throws(() => createReader({}), /required/);
  assert.throws(() => createReader({ selectData: () => first.data }), /functions/);
});
