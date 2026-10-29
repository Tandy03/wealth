const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const cache = new Map(), budgets = new Map(), logs = [];
  const context = {
    console: { error: line => logs.push(line) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => name.startsWith('FINO_BUDGET_') ? budgets.get(name) : name === 'FINO_PROXY_TOKEN' ? 'test-proxy-token' : 'test-provider-key', setProperty: (name, value) => budgets.set(name, value) }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha' }, computeDigest: () => [1, 2], base64EncodeWebSafe: () => 'digest' },
    UrlFetchApp: { fetch: () => { throw new Error('https://provider.test/?api_key=private-secret Bearer private-secret'); } },
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context);
  return { context, logs };
}
test('proxy validates actual calendar dates, clock times and prototype properties', () => {
  const { context } = harness();
  for (const date of ['2026-02-31', '2025-02-29', '2026-01-01junk']) assert.throws(() => context.requiredDate(date, 'date'));
  assert.equal(context.requiredDate('2024-02-29', 'date'), '2024-02-29');
  assert.throws(() => context.optionalDateTime('2026-01-01 24:00', 'date'));
  assert.throws(() => context.parseRequest({ postData: { contents: '{"__proto__":{}}' } }));
});
test('proxy applies a bounded request budget', () => {
  const { context } = harness(); for (let i = 0; i < 3; i++) context.consumeBudget('test', 3);
  assert.throws(() => context.consumeBudget('test', 3), error => error.code === 'PROXY_RATE_LIMITED' && error.status === 429);
});
test('proxy responses and logs never expose upstream URLs, keys or raw stacks', () => {
  const { context, logs } = harness();
  const result = context.doPost({ postData: { contents: JSON.stringify({ token: 'test-proxy-token', action: 'twelve', symbol: 'AAPL' }) } });
  assert.ok(!result.text.includes('private-secret')); assert.ok(!logs.join('').includes('private-secret'));
  assert.ok(!logs.join('').includes('https://')); assert.ok(!logs.join('').includes('stack'));
  assert.equal(JSON.parse(result.text).error.code, 'PROXY_ERROR');
});

test('proxy advertises the repository release and accepts old clients without a version field', () => {
  const { context } = harness();
  const contract = require('../../apps-script/api-contract.json');
  const post = apiVersion => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ token: 'test-proxy-token', action: 'health', ...(apiVersion === undefined ? {} : { apiVersion }) }) } }).text);
  const legacy = post(); assert.equal(legacy.ok, true); assert.deepEqual(legacy.api, contract);
  assert.deepEqual(JSON.parse(context.doGet({ parameter: { action: 'health' } }).text).api, contract);
  assert.equal(post(1).ok, true);
  for (const version of [0, 2, '1', null]) {
    const result = post(version); assert.equal(result.ok, false); assert.equal(result.error.code, 'PROXY_API_INCOMPATIBLE'); assert.equal(result.error.status, 409);
  }
});
