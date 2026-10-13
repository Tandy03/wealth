const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
const model = require('../../frontend/js/state-model');
const { protectApi } = require('../utils/apiAccess');
const { createRequestPolicy } = require('../services/market/policy');
const { retryOperation } = require('../services/googleDrive/storage');
const { logEvent, redact } = require('../utils/observability');
const { ConflictError, AuthRequiredError, ValidationError, StorageError } = require('../../frontend/js/errors');
test('state contract validates external financial records, identities and wallet values', () => {
  for (const patch of [
    { payments: [{ type: '<img>', amount: 1 }] }, { transactions: [{ type: 'UNKNOWN' }] },
    { assets: [{ type: 'stock', purchaseDate: '2026-02-31' }] }, { assets: [{ type: 'deposit', annualRate: -100 }] },
    { assets: [{ id: 'duplicate' }, { id: 'duplicate' }] }, { payments: [{ type: 'DIVIDEND', date: '2026-02-01', recordDate: '2026-03-01' }] },
    { wallet: { expenses: [{ date: '2026-01-01', category: 'Food', amount: 'bad' }], months: {}, loans: [] } },
    { transactions: [{ type: 'BUY', quantity: 1, purchasePrice: 'not-a-number' }] }, { sales: [{ type: 'stock', quantity: -1, costBasis: 100 }] },
  ]) assert.throws(() => model.validateState({ ...model.createEmptyState(), ...patch }));
  assert.throws(() => model.validateState(JSON.parse('{"assets":[],"__proto__":{"polluted":true}}')), /Unsafe/);
  assert.equal({}.polluted, undefined);
  assert.equal(model.isPaymentCompleted({ status: 'paid' }), true);
  assert.equal(model.isPaymentCompleted({ status: 'planned' }), false);
  assert.equal(model.isTransactionCompleted({ status: 'pending' }), false);
  assert.equal(model.assetLifecycle({ quantity: 100 }, 0), 'closed');
});
test('proxy headers and nonlocal peers cannot bypass the API even when Express trusts proxies', () => {
  const attempt = headers => new Promise(resolve => protectApi({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, hostname: 'localhost', protocol: 'http', get: key => headers[key], is: () => true }, { set() {} }, resolve));
  return Promise.all([
    attempt({ Host: 'attacker.invalid', 'X-Forwarded-Host': 'localhost' }),
    attempt({ Host: 'localhost', Forwarded: 'host=localhost' }),
    attempt({ Host: 'localhost', 'X-Forwarded-Proto': 'https' }),
    attempt({ Host: 'localhost:3000.attacker.invalid' }),
  ]).then(errors => errors.forEach(error => assert.equal(error.status, 403)));
});
test('same-origin browser requests require a session and foreign sessions cannot read data', async t => {
  const repository = { initializeStorage: async () => {}, readData: async () => model.createEmptyState(), drive: { getStatus: () => ({}) } };
  const server = createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/api/data', { headers: { Origin: base } })).status, 403);
  const page = await fetch(base + '/'); const cookie = page.headers.get('set-cookie').split(';')[0];
  assert.match(page.headers.get('set-cookie'), /HttpOnly/); assert.match(page.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await fetch(base + '/api/data', { headers: { Origin: base, Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/data', { headers: { Origin: base, Cookie: 'fino_session=invalid' } })).status, 403);
  assert.equal((await fetch(base + '/api/data', { headers: { Host: 'localhost', 'X-Forwarded-For': '127.0.0.1' } })).status, 403);
});

test('browser sessions renew after server restart without executing a rejected wallet write', async t => {
  let writes = 0;
  let data = model.createEmptyState();
  const repository = {
    initializeStorage: async () => {}, readData: async () => structuredClone(data),
    saveData: async next => { writes++; data = structuredClone(next); },
    runMutation: operation => operation(), drive: { getStatus: () => ({}) },
  };
  let server = createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port, base = 'http://127.0.0.1:' + port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const page = await fetch(base + '/'); await page.text();
  let cookie = page.headers.get('set-cookie').split(';')[0];
  await new Promise(resolve => server.close(resolve));
  server = createApp({ repository }).listen(port, '127.0.0.1'); await once(server, 'listening');
  const { createService } = require('../../frontend/js/api/fetchers');
  const { createService: desktop } = require('../../frontend/js/api/desktop');
  let renewals = 0;
  const transport = createService({ recoverSession: true, fetch: async (url, options) => {
    if (url === '/api/session') renewals++;
    const response = await fetch(base + url, { ...options, headers: { ...options.headers, Origin: base, Cookie: cookie } });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (response.status === 403) assert.equal(writes, 0, 'the expired session is rejected before persistence');
    return response;
  } });
  const wallet = { expenses: [], loans: [], months: { '2026-10': { plans: { Health: 250 } } } };
  const saved = await desktop(transport).saveWallet(wallet);
  assert.equal(saved.months['2026-10'].plans.Health, 250);
  assert.equal(writes, 1); assert.equal(renewals, 1);
});

test('session renewal retains origin/proxy guards and handles deep links and malformed cookies', async t => {
  const repository = { initializeStorage: async () => {}, readData: async () => model.createEmptyState(), drive: { getStatus: () => ({}) } };
  const server = createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const other = createApp({ repository }).listen(0, '127.0.0.1'); await once(other, 'listening');
  t.after(() => Promise.all([server, other].map(instance => new Promise(resolve => instance.close(resolve)))));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const headers of [
    { Origin: base }, { Origin: 'http://attacker.invalid', 'X-Fino-Session': 'renew' },
    { Origin: base, 'X-Fino-Session': 'renew', 'X-Forwarded-Host': 'localhost' },
    { 'Sec-Fetch-Site': 'cross-site', 'X-Fino-Session': 'renew' },
  ]) {
    const response = await fetch(base + '/api/session', { method: 'POST', headers });
    assert.equal(response.status, 403); assert.equal(response.headers.has('set-cookie'), false); await response.json();
  }
  const renewed = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: base, 'X-Fino-Session': 'renew' } });
  assert.equal(renewed.status, 204); assert.equal(renewed.headers.get('cache-control'), 'no-store');
  const cookie = renewed.headers.get('set-cookie').split(';')[0];
  const bad = await fetch(base + '/api/data', { headers: { Origin: base, Cookie: cookie.split('=')[0] + '=' + 'é'.repeat(64) } });
  assert.equal(bad.status, 403); assert.equal((await bad.json()).code, 'BROWSER_SESSION_REQUIRED');
  const deep = await fetch(base + '/wallet'); await deep.text();
  assert.equal(deep.status, 200); assert.match(deep.headers.get('set-cookie'), /HttpOnly/);
  const otherPage = await fetch('http://127.0.0.1:' + other.address().port + '/'); await otherPage.text();
  assert.notEqual(deep.headers.get('set-cookie').split('=')[0], otherPage.headers.get('set-cookie').split('=')[0], 'local ports use separate cookie names');
});
test('provider policy limits concurrency and request bursts without leaking URLs', () => {
  let time = 0; const policy = createRequestPolicy({ limit: 2, concurrency: 1, intervalMs: 100, now: () => time });
  const release = policy.enter('https://provider.test/?api_key=private');
  assert.throws(() => policy.enter('https://provider.test'), error => error.code === 'PROVIDER_RATE_LIMITED' && !error.message.includes('private'));
  release(); policy.enter('https://provider.test')();
  assert.throws(() => policy.enter('https://provider.test'), { status: 429 });
  time = 101; policy.enter('https://provider.test')();
});

test('a request spanning the rate-limit window releases its concurrency slot in the current window', () => {
  let time = 0;
  const policy = createRequestPolicy({ concurrency: 2, intervalMs: 100, now: () => time });
  const previousWindow = policy.enter('https://provider.test');
  time = 101;
  const currentWindow = policy.enter('https://provider.test');
  previousWindow(); currentWindow();
  const first = policy.enter('https://provider.test');
  const second = policy.enter('https://provider.test');
  first(); second();
});

test('native request slots spanning a minute are released after their response bodies are consumed', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  let time = 0;
  const context = { URL, AbortController, setTimeout, clearTimeout, fetch: async () => new Response('{}'), Date: class extends Date { static now() { return time; } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/request.js'), 'utf8'), context);
  const first = await context.FinoRequest.fetchWithTimeout('https://provider.test');
  time = 60001;
  const second = await context.FinoRequest.fetchWithTimeout('https://provider.test');
  await first.json(); await second.json();
  const responses = await Promise.all(Array.from({ length: 6 }, () => context.FinoRequest.fetchWithTimeout('https://provider.test')));
  await Promise.all(responses.map(response => response.json()));
});
test('conflict, auth, validation and storage failures are not retried', async () => {
  for (const error of [new ConflictError(), new AuthRequiredError(), new ValidationError(), new StorageError()]) {
    let count = 0; await assert.rejects(retryOperation(async () => { count++; throw error; }, 3, async () => {})); assert.equal(count, 1);
  }
});
test('central logging removes tokens, records, provider URLs and messages', t => {
  const lines = []; t.mock.method(console, 'info', line => lines.push(line));
  logEvent('sync.failed', { code: 'REMOTE_UNAVAILABLE', authorization: 'Bearer top-secret', body: { assets: [{ amount: 12345 }] }, error: new Error('private secret'), url: 'https://provider.test/?api_key=top-secret' });
  assert.equal(lines.length, 1); assert.ok(!lines[0].includes('top-secret')); assert.ok(!lines[0].includes('12345'));
  assert.equal(redact({ token: 'private', nested: { refresh_token: 'private', amount: 10 } }).token, '[redacted]');
});
