const test = require('node:test');
const assert = require('node:assert/strict');
const fetchers = require('../../frontend/js/api/fetchers');
const desktopApi = require('../../frontend/js/api/desktop');
const mobileApi = require('../../frontend/js/api/mobile');
const errors = require('../../shared/errors');

test('desktop and native failures expose the same metadata and diagnostic display', async () => {
  for (const failure of [new errors.ValidationError(), new errors.AuthRequiredError(), new errors.ConflictError(), new errors.StorageError(), new errors.RemoteUnavailableError({ status: 504, code: 'EXTERNAL_API_TIMEOUT' })]) {
    const { payload } = errors.publicError(failure);
    const response = new Response(JSON.stringify(payload), { status: failure.status,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'server-request-id' } });
    let desktop;
    try { await fetchers.readJson(response, 'Fallback'); } catch (error) { desktop = error; }
    const native = errors.clientError(failure);
    for (const field of ['message', 'status', 'code', 'category']) assert.equal(desktop[field], native[field]);
    assert.equal(desktop.requestId, 'server-request-id'); assert.ok(native.requestId);
    assert.deepEqual(Object.keys(desktop.payload).sort(), ['category', 'code', 'error']);
    assert.match(errors.displayMessage(desktop), /Request ID: server-request-id/);
    assert.ok(!Object.hasOwn(desktop, 'cause'));
  }
});

test('transport failures and broken JSON preserve diagnostics without exposing external bodies or retrying writes', async () => {
  const secret = 'private-provider-sentinel';
  for (const response of [new Response('<html>' + secret, { status: 502, headers: { 'X-Request-Id': 'html-response' } }),
    new Response('{broken ' + secret, { status: 503, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'json-response' } })]) {
    await assert.rejects(fetchers.readJson(response, 'Could not load data.'), error =>
      error.code === 'REMOTE_UNAVAILABLE' && Boolean(error.requestId) && !error.message.includes(secret));
  }
  const service = fetchers.createService({ fetch: async () => new Response(JSON.stringify({ error: 'Bearer ' + secret, access_token: secret }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(service.request('https://provider.test', { message: 'Provider is unavailable.' }), error =>
    error.category === 'remote_unavailable' && error.message === 'Provider is unavailable.' && !JSON.stringify(error).includes(secret));
  let count = 0;
  const writes = fetchers.createService({ fetch: async () => { count++; throw new Error('C:\\private\\data.json Bearer ' + secret); } });
  await assert.rejects(writes.request('/api/wallet', { method: 'PUT', body: {} }), error =>
    error.code === 'REMOTE_UNAVAILABLE' && Boolean(error.requestId) && !JSON.stringify(error).includes(secret));
  assert.equal(count, 1);
  let renewCalls = 0;
  const renewal = fetchers.createService({ recoverSession: true, fetch: async url => {
    renewCalls++; if (url === '/api/session') throw new Error(secret); return sessionDenied();
  } });
  await assert.rejects(renewal.request('/api/data'), { code: 'REMOTE_UNAVAILABLE' }); assert.equal(renewCalls, 2);
});
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
  const payload = JSON.parse(sent.options.body);
  assert.match(payload.operationId, /^[a-f0-9-]{36}$/);
  assert.deepEqual({ ...payload, operationId: undefined }, { name: 'Test', operationId: undefined });
  await assert.rejects(fetchers.readJson({ headers: { get: () => 'text/html' } }, 'fallback'), /older version/);
});
test('facade chooses desktop or native at call time without changing the caller contract', async () => {
  const calls = [];
  const desktop = desktopApi.createService({ request: async (url, options) => { calls.push({ url, options }); return 'desktop'; } });
  const adapter = { getData: async options => ({ native: options.sync }), syncApiAssets: async () => 'native-sync' };
  const mobile = mobileApi.createService({ getAdapter: () => adapter, request: async () => [{ cc: 'USD', txt: 'US Dollar', rate: 40, exchangedate: '01.01.2026' }] });
  let native = false;
  const api = mobileApi.createFacade({ desktop, mobile, isNative: () => native });
  assert.equal(await api.getData(), 'desktop');
  native = true;
  assert.deepEqual(await api.getData(), { native: false });
  assert.deepEqual(await api.getData({ sync: false }), { native: false });
  assert.equal(await api.syncInzhurAssets(), 'native-sync');
  assert.equal((await api.getExchangeRates()).rates.USD, 40);
  assert.deepEqual(Object.keys(mobile).sort(), Object.keys(desktop).sort());
  assert.equal(calls.length, 1);
});

test('native exchange-rate facade rejects invalid provider numbers, codes and calendar dates', async () => {
  for (const patch of [{ rate: true }, { rate: 'not-a-number' }, { rate: -1 }, { cc: '<img>' }, { exchangedate: '31.02.2026' }]) {
    const service = mobileApi.createService({ getAdapter: () => ({}), request: async () => [{ cc: 'USD', txt: 'US Dollar', rate: 40, exchangedate: '01.01.2026', ...patch }] });
    await assert.rejects(service.getExchangeRates());
  }
});

const sessionDenied = () => new Response(JSON.stringify({ error: 'Expired browser session.', code: 'BROWSER_SESSION_REQUIRED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
const jsonResponse = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('concurrent stale browser requests share renewal and retry their original payload once', async () => {
  let renewed = false, renewals = 0, writes = 0;
  const payloads = [];
  const service = fetchers.createService({ recoverSession: true, fetch: async (url, options) => {
    if (url === '/api/session') {
      renewals++; assert.equal(options.headers['X-Fino-Session'], 'renew'); assert.equal(options.credentials, 'same-origin');
      await new Promise(setImmediate); renewed = true; return new Response(null, { status: 204 });
    }
    payloads.push(options.body);
    if (!renewed) return sessionDenied();
    writes++; return jsonResponse({ saved: true });
  } });
  const body = { amount: 250 };
  await Promise.all([1, 2, 3].map(() => service.request('/api/wallet', { method: 'PUT', body })));
  assert.equal(renewals, 1); assert.equal(writes, 3); assert.equal(payloads.length, 6);
  assert.ok(payloads.every(payload => payload === JSON.stringify(body)));
});

test('session recovery is bounded and never retries other access/storage/provider failures', async () => {
  let calls = 0;
  const blocked = fetchers.createService({ recoverSession: true, fetch: async url => {
    calls++; return url === '/api/session' ? new Response(null, { status: 204 }) : sessionDenied();
  } });
  await assert.rejects(blocked.request('/api/data'), { code: 'BROWSER_SESSION_REQUIRED' }); assert.equal(calls, 3);
  for (const [url, recoverSession, status, code] of [
    ['/api/wallet', true, 403, 'DOMAIN_FAILURE'], ['/api/wallet', true, 503, 'STORAGE_FAILURE'],
    ['https://provider.test/data', true, 403, 'BROWSER_SESSION_REQUIRED'], ['/api/data', false, 403, 'BROWSER_SESSION_REQUIRED'],
  ]) {
    let attempts = 0;
    const service = fetchers.createService({ recoverSession, fetch: async () => { attempts++; return new Response(JSON.stringify({ error: 'Rejected', code }), { status, headers: { 'Content-Type': 'application/json' } }); } });
    await assert.rejects(service.request(url), { code }); assert.equal(attempts, 1);
  }
});
