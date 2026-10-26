const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../shared/state-model');
const { merge } = require('../services/googleDrive/merge');
test('legacy migration preserves unknown fields and is idempotent', () => {
  const legacy = { assets: [{ id: 'a', type: ' STOCK ', currency: ' usd ', quantity: '2', purchaseDate: '2024-02-29', custom: { value: 3 } }], custom: ['keep'] };
  const migrated = model.read(legacy);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.assets[0].type, 'stock');
  assert.equal(migrated.assets[0].currency, 'USD');
  assert.equal(migrated.assets[0].quantity, 2);
  assert.deepEqual(migrated.custom, legacy.custom);
  assert.deepEqual(model.write(migrated), migrated);
  assert.equal(legacy.schemaVersion, undefined);
  assert.equal(model.buildIndexes(migrated).assetsById.get('a'), migrated.assets[0]);
});
test('rejects future versions and corrupt entity fields without coercing to zero', () => {
  assert.throws(() => model.read({ assets: [], schemaVersion: 2 }), /schemaVersion/);
  for (const item of [{ quantity: 'bad' }, { purchaseDate: '2025-02-29' }, { currency: {} }]) assert.throws(() => model.read({ assets: [item] }));
  for (const type of Object.keys(model.entityFields)) assert.throws(() => model.validateEntity(type, []));
  assert.throws(() => model.validateEntity('Wallet', { expenses: 'bad' }), /expenses/);
});
test('conflict resolution requires an explicit choice and preserves deletions', () => {
  const local = { assets: [] };
  const remote = { assets: [{ id: 'deleted' }] };
  assert.throws(() => merge(local, remote), { code: 'GOOGLE_DRIVE_CONFLICT' });
  assert.deepEqual(merge(local, remote, { strategy: 'local' }).assets, []);
  assert.equal(merge(local, remote, { strategy: 'remote' }).assets.length, 1);
});
test('market sources can be replaced without network requests', async () => {
  const service = require('../domain/marketService').createService({ nbu: { getExchangeRates: async () => ({ source: 'test' }) }, fred: { getIndexHistory: async query => query } });
  assert.deepEqual(await service.getExchangeRates(), { source: 'test' });
  assert.equal((await service.getIndexHistory({ symbol: 'TEST' })).symbol, 'TEST');
});
