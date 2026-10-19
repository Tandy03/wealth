const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { assetEntries, prepareAssets, verifyAssets } = require('../scripts/mobileAssets');
const root = path.resolve(__dirname, '../..');
const shared = path.join(root, 'shared');
const modules = assetEntries(root).filter(entry => entry.relative.startsWith('shared/') && entry.relative.endsWith('.js'));
const browserScripts = [...fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8').matchAll(/<script src="(\/shared\/[^"?]+\.js)"/g)].map(match => match[1]);
const legacyScripts = modules.map(entry => '/js/' + entry.relative.slice('shared/'.length)).filter(script => fs.existsSync(path.join(root, 'frontend', script)));

test('shared modules load in Node without browser globals and legacy exports retain object identity', () => {
  const code = `
    for (const name of ['window', 'document', 'localStorage']) Object.defineProperty(globalThis, name, { get() { throw new Error('Browser dependency: ' + name); } });
    for (const filename of ${JSON.stringify(modules.map(entry => entry.source))}) require(filename);
    const model = require(${JSON.stringify(path.join(shared, 'state-model'))});
    model.validateState(model.createEmptyState());
    require(${JSON.stringify(path.join(shared, 'validation'))}).createDefault().validateIdentifier('asset-id');
  `;
  execFileSync(process.execPath, ['-e', code], { stdio: 'pipe' });
  for (const { relative } of modules) {
    const name = relative.slice('shared/'.length);
    const legacy = path.join(root, 'frontend/js', name);
    if (fs.existsSync(legacy)) assert.strictEqual(require(path.join(shared, name)), require(legacy), name);
  }
});

test('production dependency graph points into shared and shared cannot import either application', () => {
  function files(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
  for (const file of files(path.join(root, 'backend')).filter(file => file.endsWith('.js') && !file.includes(path.sep + 'tests' + path.sep))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"][^'"]*frontend\//, path.relative(root, file));
  }
  for (const { source } of modules) {
    const code = fs.readFileSync(source, 'utf8');
    assert.doesNotMatch(code, /\b(?:window|document|localStorage)\s*(?:\.|\[)|\b(?:window|document|localStorage)\b\s*[),]/, source);
    for (const match of code.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (match[1] === 'node:crypto') continue;
      assert.ok(match[1].startsWith('.'), 'Unexpected shared runtime dependency: ' + match[1]);
      assert.ok(path.resolve(path.dirname(source), match[1]).startsWith(shared + path.sep), source);
    }
  }
});

test('every compatibility shim preserves canonical browser identity or fails explicitly when its dependency is missing', () => {
  const context = vm.createContext({ URL, URLSearchParams, TextEncoder, crypto: require('node:crypto').webcrypto });
  const contract = require('../../frontend-globals.json');
  for (const script of browserScripts) vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
  const assets = assetEntries(root);
  for (const { relative } of modules) {
    const name = relative.slice('shared/'.length), legacyPath = path.join(root, 'frontend/js', name);
    if (!fs.existsSync(legacyPath)) continue;
    const legacy = '/js/' + name, canonical = '/shared/' + name;
    const owner = contract.scripts.find(script => script.src === canonical).globals[0], expected = context[owner];
    assert.ok(expected); vm.runInContext(fs.readFileSync(legacyPath, 'utf8'), context, { filename: legacy });
    assert.strictEqual(context[owner], expected, legacy);
    assert.throws(() => vm.runInContext(fs.readFileSync(legacyPath, 'utf8'), vm.createContext({})), error => error.message.includes('Load ' + canonical));
    assert.strictEqual(require(legacyPath), require(path.join(shared, name)));
    assert.ok(!require('../scripts/frontendContract').scriptSources(fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8')).includes(legacy));
    assert.ok(assets.some(entry => entry.relative === legacy.slice(1)), 'Android preparation must include old local import paths.');
  }
});

test('browser shared scripts run without Node or DOM, preserve financial results and old browser exports', async () => {
  const context = vm.createContext({ URL, URLSearchParams, TextEncoder, crypto: require('node:crypto').webcrypto });
  for (const script of browserScripts) {
    vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context, { filename: script });
    const legacy = path.join(root, 'frontend/js', script.slice('/shared/'.length));
    if (fs.existsSync(legacy)) vm.runInContext(fs.readFileSync(legacy, 'utf8'), context);
  }
  assert.equal(browserScripts.length, modules.length, 'Each implementation should be loaded exactly once.');
  const data = {
    assets: [{ id: 'a', type: 'stock', quantity: 15, purchasePrice: 100, purchaseDate: '2026-01-01' }],
    transactions: [
      { assetId: 'a', type: 'BUY', quantity: 10, amount: 1000, date: '2026-01-01' },
      { assetId: 'a', type: 'BUY', quantity: 5, amount: 1000, date: '2026-03-01' },
    ],
    sales: [{ assetId: 'a', quantity: 5, costBasis: 500, sellDate: '2026-02-01' }], payments: [],
  };
  const browserResult = context.FinoPortfolioRules.holdingsAtDate(data, 'a', '2026-04-01');
  const nodeResult = require('../../shared/portfolio-rules').holdingsAtDate(data, 'a', '2026-04-01');
  assert.deepEqual(JSON.parse(JSON.stringify(browserResult)), nodeResult);
  assert.equal(browserResult.remainingQuantity, 10); assert.equal(browserResult.remainingCost, 1500); assert.equal(browserResult.averagePrice, 150);
  assert.equal(await context.FinoSyncModel.checksum(data), await require('../../shared/sync-model').checksum(data));
  context.FinoStateModel.validateState(context.FinoStateModel.createEmptyState());
  assert.throws(() => context.FinoValidation.validateIdentifier(''), error => error instanceof context.FinoErrors.ValidationError && error.status === 400);
});

test('Android resource preparation includes identical shared files, rejects stale copies and removes obsolete assets', t => {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, '.tmp/shared-package-test-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  // Only copy non-confidential fixture resources, never generated proxy credentials.
  fs.mkdirSync(path.join(fixture, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'frontend/index.html'), browserScripts.map(script => `<script src="${script}"></script>`).join('\n'));
  for (const script of legacyScripts) {
    const target = path.join(fixture, 'frontend', script); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, 'frontend', script), target);
  }
  fs.cpSync(shared, path.join(fixture, 'shared'), { recursive: true });
  const { destination } = prepareAssets(fixture);
  for (const script of browserScripts) assert.deepEqual(fs.readFileSync(path.join(destination, script)), fs.readFileSync(path.join(root, script)));
  for (const script of legacyScripts) assert.deepEqual(fs.readFileSync(path.join(destination, script)), fs.readFileSync(path.join(root, 'frontend', script)));
  const context = vm.createContext({ URL, URLSearchParams });
  for (const script of browserScripts) vm.runInContext(fs.readFileSync(path.join(destination, script), 'utf8'), context);
  assert.equal(context.FinoPortfolioRules.holdingsAtDate({ assets: [] }, 'missing').remainingQuantity, 0);
  fs.appendFileSync(path.join(destination, 'shared/constants.js'), '\n// stale');
  assert.throws(() => verifyAssets(fixture, destination), /outdated/);
  prepareAssets(fixture);
  fs.writeFileSync(path.join(destination, 'obsolete.js'), '');
  assert.throws(() => verifyAssets(fixture, destination), /stale/);
  prepareAssets(fixture);
  assert.equal(verifyAssets(fixture, destination).length, modules.length + legacyScripts.length + 1);
});

test('web serves canonical shared bytes and missing resources cannot return the application or private files', async t => {
  t.mock.method(console, 'info', () => {});
  const { createApp } = require('../app');
  const server = createApp({ repository: {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const script of [...browserScripts, ...legacyScripts]) {
    const response = await fetch(base + script);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(script.startsWith('/shared/') ? path.join(root, script) : path.join(root, 'frontend', script)));
  }
  const cached = await fetch(base + browserScripts[0]); await cached.text();
  // Node fetch adds Cache-Control: no-cache to conditional requests; use the
  // HTTP client to exercise the browser's ordinary ETag revalidation instead.
  const cachedStatus = await new Promise((resolve, reject) => {
    require('node:http').get(base + browserScripts[0], { headers: { 'If-None-Match': cached.headers.get('etag') } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(cachedStatus, 304);
  for (const resource of ['/shared/missing.js', '/shared/.env', '/shared/%2e%2e%2fpackage.json', '/shared/']) {
    const response = await fetch(base + resource);
    assert.equal(response.status, 404, resource);
    const error = await response.json();
    assert.equal(error.code, 'NOT_FOUND'); assert.deepEqual(Object.keys(error).sort(), ['category', 'code', 'error']);
  }
});
