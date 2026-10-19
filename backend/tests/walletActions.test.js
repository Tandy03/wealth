const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../frontend/js/state-model');
const { createStore } = require('../../frontend/js/state-store');
const { createService, month } = require('../../frontend/js/controllers/wallet-actions');
test('wallet actions serialize writes and failed storage never mutates the UI snapshot', async () => {
  const store = createStore({ model });
  let fail = true;
  const service = createService({ store, api: { saveWallet: async wallet => { if (fail) throw new Error('offline'); return wallet; } } });
  const before = store.getData();
  await assert.rejects(service.mutate(wallet => { month(wallet, '2026-01').plans.Food = 20; }), /offline/);
  assert.equal(store.getData(), before);
  assert.deepEqual(store.getData().wallet.months, {});
  fail = false;
  await Promise.all([service.mutate(wallet => { month(wallet, '2026-01').plans.Food = 20; }), service.mutate(wallet => { month(wallet, '2026-01').plans.Rent = 40; })]);
  assert.deepEqual(store.getData().wallet.months['2026-01'].plans, { Food: 20, Rent: 40 });
});
test('a stale save cannot overwrite a reloaded portfolio or another account', async () => {
  const store = createStore({ model });
  let finish;
  const service = createService({ store, api: { saveWallet: wallet => new Promise(resolve => { finish = () => resolve(wallet); }) } });
  const write = service.mutate(wallet => { month(wallet, '2026-01').plans.Food = 20; });
  await new Promise(setImmediate);
  store.replaceData({ assets: [{ id: 'other-account' }] });
  finish();
  await assert.rejects(write, error => error.code === 'STALE_STATE' && error.persistence.savedLocally === true && error.applied === false);
  assert.equal(store.getData().assets[0].id, 'other-account');
  assert.deepEqual(store.getData().wallet.months, {});
});
