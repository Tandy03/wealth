const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../shared/state-model');
const { createStore } = require('../../frontend/js/state-store');
const { month } = require('../../frontend/js/controllers/wallet-actions');
const { guardFinancialReads } = require('./helpers/readonlyStore');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plan = value => ({ targets: { asset: value }, plannedAssets: [], excluded: [] });
test('state store isolates instances, validates atomic updates and keeps the compatibility reference', () => {
  const store = createStore({ model, initialState: { portfolioSort: 'purchase-date' } });
  const other = createStore({ model });
  const state = store.getState();
  const events = [];
  const unsubscribe = store.subscribe(event => events.push(event.type));
  store.updateData(draft => draft.assets.push({ id: 'asset', quantity: 2 }));
  assert.equal(state.data.assets[0].quantity, 2);
  assert.equal(other.getData().assets.length, 0);
  const before = store.getData();
  assert.throws(() => store.updateData(draft => { draft.assets[0].quantity = Infinity; }), /finite/);
  assert.equal(store.getData(), before);
  assert.throws(() => store.setUI({ data: {} }));
  store.setUI({ portfolioSort: 'invested' });
  assert.equal(store.select(state => state.portfolioSort), 'invested');
  assert.equal(store.getState(), state);
  assert.deepEqual(events, ['data:changed', 'ui:changed']);
  unsubscribe();
  store.replaceData(model.createEmptyState());
  assert.equal(events.length, 2);
});

test('loading publishes normalized data once, rejects obsolete requests and never mutates API objects', async () => {
  const store = createStore({ model }), events = [];
  store.subscribe(event => events.push(event));
  const first = deferred(), second = deferred();
  const older = store.loadData(() => first.promise), newer = store.loadData(() => second.promise);
  const data = { assets: [], wallet: { expenses: [{ category: 'Savings', date: '2026-01-01', amount: 10 }], months: { '2026-01': { plans: { Savings: 10 } } } } };
  second.resolve(data);
  assert.equal((await newer).applied, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].state.data.wallet.expenses[0].category, 'Save+invest');
  assert.equal(events[0].state.data.wallet.months['2026-01'].plans['Save+invest'], 10);
  assert.equal(data.wallet.expenses[0].category, 'Savings');
  first.resolve({ assets: [{ id: 'obsolete' }] });
  assert.equal((await older).applied, false);
  assert.equal(events.length, 1);
  const pending = deferred(), read = store.loadData(() => pending.promise);
  store.updateData(draft => { draft.assets.push({ id: 'local-edit' }); });
  pending.resolve(data);
  assert.equal((await read).applied, false);
  assert.equal(store.getData().assets[0].id, 'local-edit');
});

test('account changes invalidate reads and queued writes even before a replacement snapshot arrives', async () => {
  let account = 'account-a', calls = 0;
  const store = createStore({ model, getScope: () => account }), events = [];
  store.subscribe(event => events.push(event));
  const pending = deferred(), read = store.loadData(() => pending.promise);
  const write = deferred();
  const persist = wallet => { calls++; return write.promise.then(() => wallet); };
  const first = store.saveWallet(wallet => { month(wallet, '2026-01').plans.Food = 10; }, persist);
  const second = store.saveWallet(wallet => { month(wallet, '2026-01').plans.Rent = 20; }, persist);
  const failures = [assert.rejects(first, error => error.code === 'STALE_STATE' && error.persistence.savedLocally),
    assert.rejects(second, error => error.code === 'STALE_STATE' && !error.persistence.savedLocally)];
  await new Promise(setImmediate);
  account = 'account-b';
  pending.resolve({ assets: [{ id: 'from-account-a' }] }); write.resolve();
  assert.equal((await read).applied, false);
  await Promise.all(failures);
  assert.equal(calls, 1, 'A queued command must not execute against another account.');
  assert.equal(events.length, 0);
  assert.deepEqual(store.getData().wallet.months, {});
  const result = await store.loadData(async () => ({ assets: [{ id: 'from-account-b' }] }));
  assert.equal(result.applied, true);
  assert.equal(store.getData().assets[0].id, 'from-account-b');
});

test('initial native binding checks response provenance and explicit reconnect invalidates old responses', async () => {
  let account = null;
  const store = createStore({ model, getScope: () => account });
  const pending = deferred(), read = store.loadData(() => pending.promise);
  account = 'b';
  const wrong = model.createEmptyState(); Object.defineProperty(wrong, 'accountScope', { value: 'a' });
  pending.resolve(wrong);
  assert.equal((await read).applied, false);
  const correct = model.createEmptyState(); Object.defineProperty(correct, 'accountScope', { value: 'b' });
  assert.equal((await store.loadData(async () => correct)).applied, true);
  assert.equal(Object.hasOwn(store.getData(), 'accountScope'), false, 'Account identity is not persisted inside financial JSON.');
  const late = deferred(), obsolete = store.loadData(() => late.promise);
  store.invalidateContext();
  late.resolve(correct);
  assert.equal((await obsolete).applied, false);
  await assert.rejects(store.saveWallet(() => {}, () => assert.fail('Disconnected account must not be saved.')), { code: 'STALE_STATE' });
  assert.equal((await store.loadData(async () => correct)).applied, true);
});

test('wallet and rebalance commits preserve concurrent unrelated changes and notify only after persistence', async () => {
  const store = createStore({ model }), events = [];
  store.subscribe(event => events.push(event));
  const walletSaved = deferred(), rebalanceSaved = deferred();
  const walletWrite = store.saveWallet(wallet => { month(wallet, '2026-01').plans.Food = 20; }, wallet => walletSaved.promise.then(() => {
    Object.defineProperty(wallet, 'persistence', { value: { savedLocally: true, savedRemotely: false, backupSaved: false, state: 'sync-pending' } }); return wallet;
  }));
  const rebalanceWrite = store.saveRebalance({ plan: plan(100), expected: null }, request => rebalanceSaved.promise.then(() => request.plan));
  await new Promise(setImmediate);
  assert.equal(events.length, 0); assert.deepEqual(store.getData().wallet.months, {});
  rebalanceSaved.resolve(); const rebalanceResult = await rebalanceWrite;
  walletSaved.resolve(); const walletResult = await walletWrite;
  assert.equal(rebalanceResult.applied, true); assert.equal(walletResult.applied, true);
  assert.equal(walletResult.persistence.savedRemotely, false); assert.equal(walletResult.persistence.state, 'sync-pending');
  assert.deepEqual(store.getData().rebalance, plan(100));
  assert.equal(store.getData().wallet.months['2026-01'].plans.Food, 20);
  assert.deepEqual(events.map(event => [event.command, event.keys]), [['saveRebalance', ['rebalance']], ['saveWallet', ['wallet']]]);
  assert.equal(events[1].persistence.savedLocally, true);
  assert.equal(Object.hasOwn(store.getData().wallet, 'persistence'), false);
});

test('failed saves, invalid changes and stale rebalance responses never publish partial success', async () => {
  const store = createStore({ model }), events = [];
  store.subscribe(event => events.push(event));
  const before = store.getData(), failure = new Error('storage offline');
  await assert.rejects(store.saveWallet(wallet => { month(wallet, '2026-01').plans.Food = 20; }, async () => { throw failure; }), failure);
  await assert.rejects(store.saveWallet(wallet => { month(wallet, '2026-01').plans.Food = Infinity; }, () => assert.fail('Invalid draft reached API.')), { code: 'VALIDATION_FAILURE', category: 'validation' });
  await assert.rejects(store.saveWallet(() => {}, async wallet => { Object.defineProperty(wallet, 'persistence', { value: { savedLocally: false } }); return wallet; }), { code: 'STORAGE_FAILURE' });
  await assert.rejects(store.saveRebalance({ plan: plan(100), expected: null }, async () => { throw failure; }), failure);
  assert.equal(store.getData(), before); assert.equal(events.length, 0);
  const saved = deferred(), write = store.saveRebalance({ plan: plan(100), expected: null }, () => saved.promise);
  store.replaceData({ assets: [], rebalance: plan(20) });
  saved.resolve(plan(100));
  await assert.rejects(write, { code: 'STALE_STATE' });
  assert.deepEqual(store.getData().rebalance, plan(20));
  assert.equal(events.length, 1);
  await assert.rejects(store.saveRebalance({ plan: plan(100), expected: null }, () => assert.fail('Conflicting baseline reached API.')), { category: 'conflict' });
});

test('UI read contract rejects direct/nested writes while store commands remain usable without freezing data', async () => {
  const store = guardFinancialReads(createStore({ model }));
  assert.throws(() => { store.getState().data = {}; }, /store command/);
  assert.throws(() => { store.getData().assets.push({ id: 'bypass' }); }, /store command/);
  store.updateData(draft => { draft.assets.push({ id: 'command' }); });
  assert.throws(() => { store.getData().assets[0].name = 'bypass'; }, /store command/);
  const result = await store.saveWallet(wallet => { month(wallet, '2026-01').plans.Food = 20; }, async wallet => wallet);
  assert.throws(() => { result.value.months['2026-01'].plans.Food = 99; }, /store command/);
  assert.equal(Object.isFrozen(store.getData()), false);
  const state = store.getState();
  const analytics = require('../../frontend/js/wallet-analytics').createService({ state,
    values: { normalizeNumber: Number, getDateString: () => '2026-01-01' }, categories: ['Food'] });
  const before = JSON.stringify(store.getData());
  assert.deepEqual(analytics.walletMonth('2026-02'), { plans: {}, customCategories: [], notes: [] });
  assert.equal(analytics.walletCategoryTotal('2026-01', 'Food'), 0);
  assert.deepEqual(analytics.walletCategories('2026-02'), ['Food']);
  analytics.walletExpenseDateBounds(); analytics.walletExpenses('2026-02');
  assert.equal('cleanupUnusedWalletCategories' in analytics, false);
  assert.equal('normalizeWalletCategoryNames' in analytics, false);
  assert.equal(JSON.stringify(store.getData()), before, 'Reads must not create months or normalize published records.');
});
