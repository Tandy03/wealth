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
test('provider policy limits concurrency and request bursts without leaking URLs', () => {
  let time = 0; const policy = createRequestPolicy({ limit: 2, concurrency: 1, intervalMs: 100, now: () => time });
  const release = policy.enter('https://provider.test/?api_key=private');
  assert.throws(() => policy.enter('https://provider.test'), error => error.code === 'PROVIDER_RATE_LIMITED' && !error.message.includes('private'));
  release(); policy.enter('https://provider.test')();
  assert.throws(() => policy.enter('https://provider.test'), { status: 429 });
  time = 101; policy.enter('https://provider.test')();
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
