const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const errors = require('../../shared/errors');
const { DomainError } = require('../utils/domainError');
const { errorHandler } = require('../utils/apiError');
const { observeApi } = require('../utils/observability');
const { createApp } = require('../app');
const model = require('../../shared/state-model');

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
async function expectFailure(response, { status, code, category }, keys = ['category', 'code', 'error']) {
  const payload = await response.json();
  assert.equal(response.status, status);
  assert.deepEqual(Object.keys(payload).sort(), keys.slice().sort());
  assert.equal(payload.code, code); assert.equal(payload.category, category);
  assert.equal(typeof payload.error, 'string'); assert.ok(payload.error.length > 0);
  assert.equal(response.headers.get('x-error-category'), category);
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  return payload;
}

test('every API router uses one failure schema, preserves typed status/codes and logs each failed request once', async t => {
  const lines = []; t.mock.method(console, 'info', line => lines.push(line));
  let failure;
  const service = new Proxy({}, { get: () => async () => { throw failure; } });
  const app = express(); app.use(observeApi); app.use(express.json());
  for (const router of ['assets', 'calendar', 'data', 'market', 'payments', 'rebalance', 'sales', 'sync', 'transactions', 'wallet']) {
    app.use(require('../routes/' + router).createRouter(router === 'assets'
      ? { assets: service, purchases: service, merges: service, sync: service } : service));
  }
  app.use(errorHandler);
  const base = await serve(t, app);
  const routes = [
    ['GET', '/api/data'], ['GET', '/api/assets'], ['POST', '/api/assets'], ['POST', '/api/assets/sync-inzhur'],
    ['POST', '/api/assets/merge'], ['PUT', '/api/assets/id'], ['POST', '/api/assets/id/buy'], ['DELETE', '/api/assets/id'],
    ['GET', '/api/calendar-notes'], ['POST', '/api/calendar-notes'], ['GET', '/api/payments'], ['POST', '/api/payments'],
    ['PATCH', '/api/payments/id/received'], ['GET', '/api/sales'], ['POST', '/api/sales'], ['GET', '/api/transactions'],
    ['POST', '/api/transactions'], ['PUT', '/api/wallet'], ['PUT', '/api/rebalance'],
    ['GET', '/api/google-drive/status'], ['GET', '/api/sync/status'], ['POST', '/api/google-drive/sync'], ['POST', '/api/sync/google-drive'],
    ...['exchange-rates', 'market-data/time-series', 'market-data/currencies', 'market-data/currency-history',
      'market-data/frankfurter-history', 'market-data/index-history', 'macroeconomics', 'macroeconomics/policy-rate', 'inzhur-assets'].map(path => ['GET', '/api/' + path]),
  ];
  for (const error of [new DomainError({ error: 'Valid date is required.' }), new errors.AuthRequiredError({ code: 'GOOGLE_AUTH_REQUIRED' }),
    new errors.ConflictError(), new errors.StorageError(), new errors.RemoteUnavailableError({ code: 'EXTERNAL_API_TIMEOUT', status: 504 })]) {
    failure = error;
    for (const [method, route] of routes) {
      const before = lines.length;
      const response = await fetch(base + route, { method });
      await expectFailure(response, error);
      const records = lines.slice(before).map(JSON.parse);
      assert.equal(records.length, 1, method + ' ' + route);
      assert.equal(records[0].requestId, response.headers.get('x-request-id'));
      assert.equal(records[0].code, error.code); assert.equal(records[0].category, error.category);
    }
  }
});

test('real app guards, JSON parser and unknown endpoints share the contract and successful payloads are unchanged', async t => {
  t.mock.method(console, 'info', () => {});
  const data = model.createEmptyState();
  const repository = { readData: async () => data, getSyncStatus: () => ({ state: 'local-saved', savedLocally: true }),
    drive: {}, initializeStorage: async () => {} };
  const base = await serve(t, createApp({ repository }));
  await expectFailure(await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }),
    { status: 400, code: 'INVALID_JSON', category: 'validation' });
  await expectFailure(await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a'.repeat(2 * 1024 * 1024) }) }),
    { status: 413, code: 'REQUEST_TOO_LARGE', category: 'validation' });
  await expectFailure(await fetch(base + '/api/data', { headers: { Origin: 'https://untrusted.test' } }),
    { status: 403, code: 'DOMAIN_FAILURE', category: 'access_denied' });
  await expectFailure(await fetch(base + '/api/data', { headers: { Origin: base } }),
    { status: 403, code: 'BROWSER_SESSION_REQUIRED', category: 'access_denied' });
  for (const route of ['/api/not-an-endpoint', '/api']) await expectFailure(await fetch(base + route),
    { status: 404, code: 'NOT_FOUND', category: 'not_found' });
  const response = await fetch(base + '/api/data'); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), data); assert.equal(response.headers.get('x-error-category'), null);
});

test('unexpected exceptions, forged payloads and sensitive typed messages never escape into responses or logs', async t => {
  const lines = []; t.mock.method(console, 'info', line => lines.push(line));
  const privateValue = 'private-diagnostic-sentinel';
  const app = express(); app.use(observeApi);
  const cause = new Error('Bearer ' + privateValue + ' C:\\local\\portfolio.json {"amount":123456}');
  app.get('/api/unexpected', () => { throw Object.assign(cause, { status: 401, code: privateValue,
    payload: { error: privateValue, stack: cause.stack, access_token: privateValue } }); });
  app.get('/api/typed', () => { throw new errors.StorageError({ message: cause.message, cause,
    details: { response: { access_token: privateValue }, stack: cause.stack } }); });
  app.get('/api/sync', () => {
    const failure = new errors.ConflictError();
    failure.payload.status = { state: 'sync-pending', savedLocally: true, savedRemotely: false,
      email: privateValue, access_token: privateValue, assets: [{ amount: 123456 }], error: cause.message };
    throw failure;
  });
  app.use(errorHandler); const base = await serve(t, app);
  const unexpected = await expectFailure(await fetch(base + '/api/unexpected'), { status: 500, code: 'INTERNAL_ERROR', category: 'internal_error' });
  assert.equal(unexpected.error, 'Internal server error.');
  await expectFailure(await fetch(base + '/api/typed'), { status: 503, code: 'STORAGE_FAILURE', category: 'storage_failure' });
  const sync = await expectFailure(await fetch(base + '/api/sync'), { status: 409, code: 'SYNC_CONFLICT', category: 'conflict' }, ['error', 'code', 'category', 'status']);
  assert.deepEqual(sync.status, { state: 'sync-pending', savedLocally: true, savedRemotely: false });
  assert.ok(!JSON.stringify(lines).includes(privateValue)); assert.ok(!JSON.stringify(lines).includes('123456'));
  assert.ok(!JSON.stringify(lines).includes('portfolio.json'));
  for (const message of ['https://provider.test/?access_token=' + privateValue, '/home/user/private/file.json', '{"client_secret":"' + privateValue + '"}']) {
    assert.ok(!JSON.stringify(errors.publicError(new errors.AuthRequiredError({ message }))).includes(privateValue));
  }
});

test('a failure after headers delegates to Express without a second response or confidential default logging', () => {
  let forwarded;
  const response = { headersSent: true, status() { assert.fail('second status'); }, json() { assert.fail('second response'); } };
  errorHandler(new Error('Bearer private-token C:\\local\\secrets.json'), {}, response, error => { forwarded = error; });
  assert.ok(forwarded instanceof Error); assert.equal(forwarded.stack, 'Request failed after response headers were sent.');
  assert.ok(!JSON.stringify(forwarded).includes('private-token'));
});
