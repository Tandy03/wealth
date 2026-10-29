const test = require('node:test');
const assert = require('node:assert/strict');
// Requiring the actual entry point needs no DOM, global store or browser API.
const { createApplication } = require('../../frontend/js/app');
const errors = require('../../shared/errors');
const flush = () => new Promise(setImmediate);
function fixture(overrides = {}) {
  const calls = [], logs = [], notices = [];
  let resolveSync, rejectSync, current = true;
  const context = {};
  const sync = new Promise((resolve, reject) => { resolveSync = resolve; rejectSync = reject; });
  const app = createApplication({
    store: { capture: () => context, isCurrent: value => value === context && current },
    api: { getData: options => { calls.push(['sync', options]); return sync; } },
    refreshData: async () => { calls.push('load'); return { applied: true }; },
    render: () => calls.push('render'),
    initializeController: setup => setup(), controllers: [['Example', () => calls.push('setup')]],
    diagnostics: errors.diagnostics, logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    showNotice: value => notices.push(value), isNative: () => false, ...overrides,
  });
  return { app, calls, logs, notices, resolveSync, rejectSync, stale: () => { current = false; } };
}
test('injected bootstrap renders local data without waiting for optional sync and retains request/render counts', async () => {
  const f = fixture();
  await f.app.init();
  assert.deepEqual(f.calls, ['setup', 'load', 'render', ['sync', { sync: true }]]);
  f.resolveSync(); await flush();
  assert.deepEqual(f.calls.slice(4), ['load', 'render']);
  assert.deepEqual(f.logs, []);
});
test('stale account/snapshot background success and failure cannot reload data or show stale errors', async () => {
  for (const failed of [false, true]) {
    const f = fixture(); await f.app.init(); f.stale();
    if (failed) f.rejectSync(new Error('expired account')); else f.resolveSync();
    await flush();
    assert.equal(f.calls.filter(call => call === 'load').length, 1);
    assert.deepEqual(f.logs, []); assert.deepEqual(f.notices, []);
  }
});
test('a discarded data response causes no render or benchmark request', async () => {
  const f = fixture({ refreshData: async () => ({ applied: false }) });
  assert.deepEqual(await f.app.loadData(), { applied: false });
  assert.deepEqual(f.calls, []);
});
test('controller initialization errors are visible and sanitized while other controllers still start', async () => {
  let nextStarted = false;
  const f = fixture({ controllers: [
    ['Broken', () => { throw new Error('private provider body/token/financial records'); }],
    ['Next', () => { nextStarted = true; }],
  ] });
  await assert.rejects(f.app.init(), /UI initialization failed/);
  assert.equal(nextStarted, true); assert.ok(f.calls.includes('render'));
  assert.equal(f.logs.length, 2); assert.equal(f.logs[0][0], 'Broken setup failed:');
  assert.ok(!JSON.stringify(f.logs).includes('private provider'));
});
test('initialization failure keeps the user-facing request ID and does not start background sync', async () => {
  const failure = Object.assign(new Error('Could not load your portfolio.'), { requestId: 'bootstrap-request' });
  const f = fixture({ refreshData: async () => { throw failure; } });
  await assert.rejects(f.app.init(), error => error === failure);
  assert.deepEqual(f.calls, ['setup']); assert.deepEqual(f.notices, [failure]);
  assert.equal(f.logs.length, 1);
});
