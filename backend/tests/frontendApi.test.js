const test = require('node:test');
const assert = require('node:assert/strict');
const fetchers = require('../../frontend/js/api/fetchers');
const desktopApi = require('../../frontend/js/api/desktop');
const mobileApi = require('../../frontend/js/api/mobile');
test('transport preserves request payloads and structured error metadata', async () => {
  let sent;
  const { request } = fetchers.createService({ fetch: async (url, options) => {
    sent = { url, options };
    return { ok: false, status: 409, headers: { get: name => ({ 'content-type': 'application/json', 'x-error-category': 'conflict', 'x-request-id': 'request' })[name] }, json: async () => ({ error: 'Conflict' }) };
  } });
  const desktop = desktopApi.createService({ request });
  await assert.rejects(desktop.createAsset({ name: 'Test' }), error => error.status === 409 && error.category === 'conflict' && error.requestId === 'request');
  assert.equal(sent.url, '/api/assets');
  assert.equal(sent.options.method, 'POST');
  assert.deepEqual(JSON.parse(sent.options.body), { name: 'Test' });
  await assert.rejects(fetchers.readJson({ headers: { get: () => 'text/html' } }, 'fallback'), /older version/);
});
test('facade chooses desktop or native at call time without changing the caller contract', async () => {
  const calls = [];
  const desktop = desktopApi.createService({ request: async (url, options) => { calls.push({ url, options }); return 'desktop'; } });
  const adapter = { getData: async options => ({ native: options.sync }), syncApiAssets: async () => 'native-sync' };
  const mobile = mobileApi.createService({ getAdapter: () => adapter, request: async () => [{ cc: 'USD', rate: 40, exchangedate: '01.01.2026' }] });
  let native = false;
  const api = mobileApi.createFacade({ desktop, mobile, isNative: () => native });
  assert.equal(await api.getData(), 'desktop');
  native = true;
  assert.deepEqual(await api.getData({ sync: false }), { native: false });
  assert.equal(await api.syncInzhurAssets(), 'native-sync');
  assert.equal((await api.getExchangeRates()).rates.USD, 40);
  assert.deepEqual(Object.keys(mobile).sort(), Object.keys(desktop).sort());
  assert.equal(calls.length, 1);
});
