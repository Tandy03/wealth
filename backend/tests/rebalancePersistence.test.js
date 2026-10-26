const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const model = require('../../shared/state-model');
const plan = () => ({ targets: { ovdp: 30, 'planned-etf': 70 }, plannedAssets: [{ id: 'planned-etf', label: 'Next ETF' }], excluded: ['stock::other'] });

test('rebalance drafts validate on import and retain sparse legacy compatibility', () => {
  const value = { ...model.createEmptyState(), rebalance: plan() };
  assert.deepEqual(model.read(value).rebalance, plan());
  assert.equal(model.read({ assets: [] }).rebalance, undefined);
  for (const bad of [null, [], { ...plan(), targets: { ovdp: '30' } }, { ...plan(), targets: { ovdp: NaN } },
    { ...plan(), targets: { ovdp: 100.1 } }, { ...plan(), targets: { ovdp: -1 } }, { ...plan(), targets: { ovdp: 0.01 } },
    { ...plan(), excluded: ['ovdp', 'ovdp'] }, { ...plan(), excluded: ['planned-etf'] },
    { ...plan(), plannedAssets: [{ id: 'ovdp', label: 'Fake existing group' }] },
    { ...plan(), plannedAssets: [{ id: 'planned-a', label: ' ' }] }, { ...plan(), unknown: true }]) {
    assert.throws(() => model.read({ ...model.createEmptyState(), rebalance: bad }), { code: 'VALIDATION_FAILURE' });
  }
  assert.throws(() => model.validateRebalance(JSON.parse('{"targets":{"__proto__":10},"plannedAssets":[],"excluded":[]}')), /Unsafe/);
  const draft = plan(); draft.targets.ovdp = 5;
  assert.doesNotThrow(() => model.validateRebalance(draft), 'incomplete totals are valid saved drafts');
});

test('rebalance endpoint requires a browser session, preserves holdings and rejects stale edits atomically', async t => {
  const initial = { ...model.createEmptyState(), assets: [{ id: 'bond', type: 'ovdp', quantity: 10, purchasePrice: 1000 }] };
  let data = structuredClone(initial), writes = 0, queue = Promise.resolve();
  const repository = { initializeStorage: async () => {}, readData: async () => structuredClone(data),
    saveData: async next => { writes++; data = model.normalizeState(next); },
    runMutation: operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
    getSyncStatus: () => ({ state: 'sync-pending', savedLocally: true, savedRemotely: false }), drive: { getStatus: () => ({}) } };
  const server = require('../app').createApp({ repository }).listen(0, '127.0.0.1');
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const page = await fetch(base + '/'); await page.text();
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const write = (body, authorized = true) => fetch(base + '/api/rebalance', { method: 'PUT',
    headers: { Origin: base, 'Content-Type': 'application/json', ...(authorized ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await write({ plan: plan(), expected: null }, false)).status, 403); assert.equal(writes, 0);
  const saved = await write({ plan: plan(), expected: null });
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('x-saved-locally'), 'true');
  assert.equal(saved.headers.get('x-saved-remotely'), 'false');
  assert.deepEqual(await saved.json(), plan()); assert.equal(writes, 1);
  const stale = await write({ plan: { ...plan(), excluded: [] }, expected: null });
  assert.equal(stale.status, 409); assert.equal(writes, 1);
  assert.equal((await write({ plan: { ...plan(), targets: { ovdp: 'bad' } }, expected: plan() })).status, 400);
  assert.equal(writes, 1); assert.deepEqual(data.assets, initial.assets);
  const before = structuredClone(data); delete before.rebalance;
  assert.deepEqual(before, initial);
  const changed = plan(); changed.targets.ovdp = 40;
  assert.equal((await write({ plan: changed, expected: plan() })).status, 200);
  assert.deepEqual(data.rebalance, changed);
});
