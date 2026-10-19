const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const operations = require('../../shared/operations');
const model = require('../../shared/state-model');
const { harness } = require('./helpers/nativeHarness');
const clone = value => JSON.parse(JSON.stringify(value));
const stock = () => ({ name: 'Compaction stock', type: 'stock', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01', currency: 'USD' });
function sample(index = 0) {
  return { operationId: 'receipt-' + index, kind: 'buyMoreAsset', target: 'asset', createdAt: '2026-01-01T12:00:00.000Z',
    command: { quantity: 2, purchasePrice: 120, purchaseDate: '2026-01-02' },
    result: { asset: { ...stock(), id: 'asset', instrumentName: 'Test instrument', createdAt: '2026-01-01T00:00:00Z',
      currentPrice: 125, remainingCostBasis: 1240, remainingQuantity: 12, dividendRecordRule: 'previous_month_end' },
      transaction: { id: 'transaction-' + index, assetId: 'asset', type: 'BUY', quantity: 2, amount: 240, purchasePrice: 120, date: '2026-01-02', currency: 'USD' } } };
}
test('receipt SHA-256 matches Node crypto for canonical key order, Unicode and multiple blocks', () => {
  for (const command of [{}, { text: 'Дані 😀', number: 1 }, { text: 'x'.repeat(500) }, { text: '\ud800' }]) {
    const descriptor = { kind: 'createAsset', target: null, command };
    assert.equal(operations.fingerprint(descriptor), crypto.createHash('sha256').update(operations.canonical([descriptor.kind, descriptor.target, command])).digest('hex'));
  }
});
test('30 UTC calendar days retain exact replay; compaction expires results without changing financial data', () => {
  const data = { ...model.createEmptyState(), operations: [sample()] }, original = clone(data);
  const command = { ...data.operations[0].command, operationId: 'receipt-0' };
  const descriptor = operations.describe('buyMoreAsset', ['asset', command]);
  assert.equal(operations.compact(data, Date.parse('2026-01-31T11:59:59.999Z')), 0);
  assert.deepEqual(operations.begin(data, descriptor).result, original.operations[0].result);
  assert.equal(operations.compact(data, Date.parse('2026-01-31T12:00:00.000Z')), 1);
  assert.equal(operations.compact(data, Date.parse('2027-01-01T00:00:00Z')), 0);
  assert.deepEqual({ ...data, operations: [] }, { ...original, operations: [] });
  assert.deepEqual(Object.keys(data.operations[0]).sort(), ['operationId', 'fingerprint', 'createdAt', 'expired', 'defaultCurrency'].sort());
  for (const currency of [undefined, 'USD']) assert.throws(() => operations.begin(data, operations.describe('buyMoreAsset', ['asset', { ...command, currency }])), { code: 'OPERATION_RESULT_EXPIRED', status: 409, category: 'conflict' });
  assert.throws(() => operations.begin(data, operations.describe('buyMoreAsset', ['asset', { ...command, quantity: 3 }])), { code: 'OPERATION_ID_CONFLICT' });
  model.validateState(data); model.validateState(model.createEmptyState());
  for (const patch of [{ fingerprint: 'invalid' }, { expired: false }, { result: original.operations[0].result }, { command: {} }, { createdAt: 'invalid' }]) {
    assert.throws(() => model.validateState({ ...data, operations: [{ ...data.operations[0], ...patch }] }), { code: 'VALIDATION_FAILURE' });
  }
});
test('1,000 historical receipts shrink by at least 60 percent, retaining every operation ID', t => {
  const data = { ...model.createEmptyState(), operations: Array.from({ length: 1000 }, (_, i) => sample(i)) };
  model.validateState(data);
  const before = Buffer.byteLength(JSON.stringify(data.operations));
  assert.equal(operations.compact(data, Date.parse('2026-03-01T00:00:00Z')), 1000);
  const after = Buffer.byteLength(JSON.stringify(data.operations));
  assert.ok(after < before * 0.4, `${before} -> ${after} bytes`);
  t.diagnostic(`1000 receipt fixture: ${before} full bytes -> ${after} tombstone bytes (${(100 * (1 - after / before)).toFixed(1)}% smaller).`);
  assert.equal(new Set(data.operations.map(entry => entry.operationId)).size, 1000);
  model.validateState(data);
});
test('real repository/journal compaction is atomic and expired/conflicting replay survives backend/native restart', async t => {
  const root = path.resolve(__dirname, '../../.tmp'); await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'compact-receipts-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const create = () => require('../data/repository').createRepository({ dataFile: path.join(dir, 'data.json'), drive: { isEnabled: () => false } });
  const repo = create(), body = { ...stock(), operationId: 'historical-create' };
  await require('../domain/assetService').createService(repo).createAsset(body);
  await repo.runMutation(async () => {
    const snapshot = await repo.readData(); snapshot.operations[0].createdAt = '2020-01-01T00:00:00Z'; await repo.writeLocalData(snapshot);
  });
  const before = await repo.readData();
  await repo.runMutation(async () => repo.saveData(await repo.readData()));
  const compacted = await repo.readData();
  for (const key of ['assets', 'transactions', 'payments', 'wallet', 'rebalance']) assert.deepEqual(compacted[key], before[key]);
  assert.equal(compacted.operations[0].expired, true);
  const restarted = create(), commits = (await repo.journalHistory()).length;
  await assert.rejects(require('../domain/assetService').createService(restarted).createAsset(body), { code: 'OPERATION_RESULT_EXPIRED' });
  assert.equal((await restarted.journalHistory()).length, commits);
  const native = harness({ local: compacted }); native.offline(true);
  await assert.rejects(native.api.createAsset(body), { code: 'OPERATION_RESULT_EXPIRED' });
  await assert.rejects(native.api.createAsset({ ...body, quantity: 11 }), { code: 'OPERATION_ID_CONFLICT' });
  await native.drain();
  assert.equal(native.local().operations[0].fingerprint, compacted.operations[0].fingerprint);
  const receipt = (await restarted.journalHistory()).at(-1).snapshot.operations[0]; assert.equal(receipt.expired, true);
});
