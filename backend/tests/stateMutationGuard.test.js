const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../../frontend/js/state-store');
const model = require('../../shared/state-model');
const fixture = () => ({ ...model.createEmptyState(), assets: [{ id: 'a', name: 'Private holding', quantity: 2, purchasePrice: 100 }] });
test('test guard detects snapshot replacement, nested writes, arrays and subscription mutations', () => {
  const store = createStore({ model, guard: 'test', initialState: { data: fixture() } });
  const snapshot = store.getState();
  for (const mutate of [() => { snapshot.data = fixture(); }, () => { snapshot.data.assets = []; },
    () => { store.getData().assets[0].quantity = 99; }, () => store.select(state => state.data.assets).push({}),
    () => { Object.getOwnPropertyDescriptor(snapshot, 'data').value.assets[0].quantity = 99; },
    () => { delete snapshot.data.assets[0].name; }, () => Object.defineProperty(snapshot.data, 'assets', { value: [] })]) {
    assert.throws(mutate, /store command/);
  }
  let notified = 0;
  store.subscribe(event => { notified++; assert.throws(() => { event.state.data.assets[0].quantity = 99; }, /store command/); });
  store.updateData(draft => { draft.assets[0].quantity = 3; });
  assert.equal(store.getData().assets[0].quantity, 3); assert.equal(notified, 1);
});
test('private drafts, source API objects and UI fields retain their contracts under the guard', async () => {
  const source = fixture(), original = JSON.stringify(source);
  const store = createStore({ model, guard: 'test' });
  await store.loadData(async () => source);
  assert.equal(JSON.stringify(source), original); source.assets[0].quantity = 99;
  assert.equal(store.getData().assets[0].quantity, 2);
  let leaked;
  store.updateData(draft => { leaked = draft; draft.assets[0].quantity = 4; });
  leaked.assets[0].quantity = 100;
  assert.equal(store.getData().assets[0].quantity, 4);
  assert.throws(() => store.updateData(async () => {}), /synchronous/);
  store.setUI({ portfolioSort: 'name' }); assert.equal(store.getState().portfolioSort, 'name');
  const saved = await store.saveWallet(wallet => { wallet.months['2026-10'] = { plans: { Health: 15 } }; }, async draft => draft);
  assert.equal(saved.applied, true); assert.throws(() => { saved.value.months['2026-10'].plans.Health = 99; }, /store command/);
});
test('development diagnostics identify operation/context without financial values or dynamic user keys', () => {
  const diagnostics = [], store = createStore({ model, guard: 'development', onViolation: diagnostic => diagnostics.push(diagnostic), initialState: { data: fixture() } });
  assert.throws(() => { store.getData().assets[0].name = 'secret'; }, /set at data.assets.\[entry\].name/);
  assert.equal(diagnostics[0].code, 'DIRECT_STATE_MUTATION'); assert.equal(diagnostics[0].type, 'set');
  assert.doesNotMatch(JSON.stringify(diagnostics), /Private holding|secret/);
});
test('production configuration constructs no mutation proxies and preserves store results', () => {
  const OriginalProxy = globalThis.Proxy;
  globalThis.Proxy = function () { throw new Error('Production proxy overhead'); };
  try {
    const store = createStore({ model, initialState: { data: fixture() } });
    store.updateData(draft => { draft.assets[0].quantity = 3; });
    assert.equal(store.getData().assets[0].quantity, 3);
    store.setUI({ section: 'analytics' }); assert.equal(store.getState().section, 'analytics');
  } finally { globalThis.Proxy = OriginalProxy; }
});
