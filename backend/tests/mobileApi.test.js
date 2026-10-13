const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/mobile-api.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const signature = (value) => JSON.stringify((function canonical(item) { return Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item; })(value));
const fixture = () => ({ schemaVersion: 1, sync: { revision: 7, updatedAt: '2026-01-01T00:00:00Z', deviceId: 'desktop' }, assets: [{ id: 'bond', name: 'Bond', type: 'ovdp', quantity: 10, remainingQuantity: 10, remainingCostBasis: 10000, purchasePrice: 1000, currency: 'UAH' }], transactions: [{ id: 'buy', assetId: 'bond', type: 'BUY', quantity: 10, amount: 10000, date: '2026-01-01' }], sales: [], payments: [], calendarNotes: [], priceHistory: [], wallet: { expenses: [], months: {}, loans: [] }, instruments: [] });

test('native pending purchases never rewrite completed financial history', async () => {
  const local = fixture();
  local.transactions.push({ id: 'pending', assetId: 'bond', type: 'BUY', status: 'pending', quantity: 5, amount: 10000, date: '2026-02-01' });
  const h = harness({ local });
  const data = await h.api.getData({ sync: false });
  assert.equal(data.transactions[0].quantity, 10); assert.equal(data.transactions[0].amount, 10000);
  assert.equal(data.assets[0].remainingQuantity, 10); assert.equal(data.assets[0].remainingCostBasis, 10000);
  assert.deepEqual(h.local().transactions, local.transactions);
});

test('normalizing a downloaded portfolio stays pending until the exact local version is uploaded', async () => {
  const h = harness(); await h.api.getData();
  const remote = h.remote(); delete remote.assets[0].remainingQuantity; delete remote.assets[0].remainingCostBasis;
  h.changeRemote(remote);
  await h.api.syncGoogleDrive('download');
  assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-pending');
  assert.ok(h.local().sync.revision > remote.sync.revision);
  assert.equal(h.remote().assets[0].remainingQuantity, undefined);
  await h.api.syncGoogleDrive();
  assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-confirmed');
  assert.deepEqual(h.remote(), h.local());
});

test('normalized local data is durably journaled and failure cannot expose an uncommitted cache', async () => {
  const local = fixture(); delete local.assets[0].remainingQuantity;
  const h = harness({ local }); h.hooks.failPreference = key => key.startsWith('fino-journal-v1:');
  await assert.rejects(h.api.getData({ sync: false }), { code: 'STORAGE_FAILURE' });
  assert.deepEqual(h.local(), local);
  h.hooks.failPreference = null;
  const data = await h.api.getData({ sync: false });
  assert.equal(data.assets[0].remainingQuantity, 10);
  assert.equal((await h.api.getGoogleDriveStatus()).savedRemotely, false);
  assert.deepEqual(h.local(), clone(data));
});

test('a remote change during download is rejected without replacing the local portfolio', async () => {
  const h = harness(); await h.api.getData(); const before = h.local();
  h.hooks.afterMedia = () => { h.hooks.afterMedia = null; const remote = h.remote(); remote.calendarNotes.push({ id: 'race', text: 'concurrent edit' }); h.changeRemote(remote); };
  await assert.rejects(h.api.syncGoogleDrive('download'), { code: 'SYNC_CONFLICT' });
  assert.deepEqual(h.local(), before); assert.equal(h.backups.length, 0);
});

test('native refuses shared main files and ambiguous duplicate portfolio files', async () => {
  const h = harness(); h.hooks.notOwned = true;
  await assert.rejects(h.api.syncGoogleDrive(), { code: 'AUTHORIZATION_REQUIRED' });
  assert.equal(h.uploads.length, 0);
  const duplicate = harness(); duplicate.hooks.portfolioFiles = [{ id: 'one' }, { id: 'two' }];
  await assert.rejects(duplicate.api.syncGoogleDrive(), { code: 'SYNC_CONFLICT' });
  assert.equal(duplicate.uploads.length, 0);
});

test('remote deletion on a clean phone requires an explicit replacement choice', async () => {
  const h = harness(); await h.api.getData(); const before = h.local(); h.changeRemote(null);
  await assert.rejects(h.api.syncGoogleDrive(), { code: 'SYNC_CONFLICT' });
  assert.equal(h.remote(), null); assert.equal(h.uploads.length, 0); assert.deepEqual(h.local(), before);
  await h.api.syncGoogleDrive('upload');
  assert.deepEqual(h.remote(), before); assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-confirmed');
});

test('successful upload HTTP status alone never confirms unsaved native data', async () => {
  const h = harness(); await h.api.getData(); h.hooks.dropUpload = true;
  await h.api.createCalendarNote({ assetId: 'bond', text: 'not yet uploaded', date: '2026-10-01' }); await h.drain();
  const status = await h.api.getGoogleDriveStatus();
  assert.equal(status.savedRemotely, false); assert.equal(status.state, 'conflict');
  assert.equal(h.local().calendarNotes.length, 1); assert.equal(h.remote().calendarNotes.length, 0);
});

test('registered FinoStorage handles native journal writes and invalid actions make no Drive requests', async () => {
  const h = harness({ confirmedStorage: true }); await h.api.getData({ sync: false });
  await assert.rejects(h.api.syncGoogleDrive('unknown'), { code: 'VALIDATION_FAILURE' });
  assert.equal(h.hooks.driveCalls || 0, 0);
  h.offline(true); await h.api.createCalendarNote({ assetId: 'bond', text: 'confirmed disk storage', date: '2026-10-01' }); await h.drain();
  assert.equal(h.local().calendarNotes.length, 1);
  assert.ok(h.storage.get('fino-journal-v1:test%40example.com'));
});

test('native journal failure rejects a financial edit without changing data or sync metadata', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  const before = h.local(), metadata = h.storage.get('fino-sync-v2:test%40example.com');
  h.hooks.failPreference = key => key.startsWith('fino-journal-v1:');
  await assert.rejects(h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-01' }), { code: 'STORAGE_FAILURE' });
  assert.deepEqual(h.local(), before); assert.equal(h.storage.get('fino-sync-v2:test%40example.com'), metadata);
  assert.deepEqual(clone(await h.api.getData({ sync: false })), before);
});
test('native committed journal recovers a failed compatibility cache write after restart', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  h.hooks.failPreference = key => key.startsWith('fino-data-v1:');
  const purchase = await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-01' });
  assert.equal(purchase.persistence.savedLocally, true); assert.equal(purchase.persistence.savedRemotely, false);
  await h.drain();
  const restarted = harness({ local: h.local(), remote: h.remote() });
  restarted.storage.set('fino-journal-v1:test%40example.com', h.storage.get('fino-journal-v1:test%40example.com'));
  const recovered = await restarted.api.getData({ sync: false });
  assert.equal(recovered.assets[0].quantity, 11); assert.equal(recovered.transactions.length, 2);
  assert.equal((await restarted.api.getGoogleDriveStatus()).state, 'sync-pending');
});
test('native manual backup keeps unsent financial changes pending', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-01' }); await h.drain();
  h.offline(false); const result = await h.api.syncGoogleDrive('backup');
  assert.equal(result.savedLocally, true); assert.equal(result.savedRemotely, false); assert.equal(result.backupSaved, true);
  assert.equal(result.status.state, 'sync-pending'); assert.equal(h.remote().assets[0].quantity, 10);
});

test('native sale then purchase uses the remaining cost and preserves earlier sale results', async () => {
  const local = fixture();
  Object.assign(local.assets[0], { name: 'Stock', type: 'stock', purchasePrice: 100, currentPrice: 200, purchaseDate: '2026-01-01' });
  local.transactions[0].amount = 1000;
  const h = harness({ local });
  await h.api.getData({ sync: false }); h.offline(true);
  await h.api.createSale({ assetId: 'bond', quantity: 5, sellPrice: 120, sellDate: '2026-02-01' });
  const firstSale = clone(h.local().sales[0]);
  const bought = await h.api.buyMoreAsset('bond', { quantity: 5, purchasePrice: 200, purchaseDate: '2026-03-01' });
  assert.equal(bought.purchasePrice, 150);
  assert.equal(bought.remainingQuantity, 10);
  assert.equal(bought.remainingCostBasis, 1500);
  await h.api.createSale({ assetId: 'bond', quantity: 2, sellPrice: 200, sellDate: '2026-04-01' });
  assert.equal(h.local().sales[1].costBasis, 300);
  assert.deepEqual(h.local().sales[0], firstSale);
  await h.drain();
});

test('native merge builds one dividend schedule and rejects incompatible ticker metadata', async () => {
  const h = harness(); await h.api.getData({ sync: false }); h.offline(true);
  const body = { name: 'REIT', type: 's1_reit', currency: 'UAH', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01', dividendPerUnit: 10, firstDividendDate: '2026-11-10' };
  const a = await h.api.createAsset(body), b = await h.api.createAsset(body);
  await h.api.mergeAssets([a.id, b.id]);
  const dividends = h.local().payments.filter(p => p.assetId === a.id && p.date === '2026-11-10');
  assert.equal(dividends.length, 1);
  assert.equal(dividends[0].amount, 200);
  const c = await h.api.createAsset({ ...body, ticker: 'OTHER' });
  const before = h.local();
  await assert.rejects(h.api.mergeAssets([a.id, c.id]), /matching/);
  assert.deepEqual(h.local(), before);
  await h.drain();
});

test('native market sync permits concurrent purchases and applies prices to the latest snapshot', async () => {
  const local = fixture();
  Object.assign(local.assets[0], { isin: 'TEST', purchaseDate: '2026-01-01' });
  const h = harness({ local }); await h.api.getData({ sync: false }); h.offline(true);
  let release, fetched;
  const started = new Promise(resolve => { fetched = resolve; });
  const catalog = new Promise(resolve => { release = resolve; });
  h.offline(false);
  h.hooks.inzhurCatalog = () => { fetched(); return catalog; };
  const sync = h.api.syncApiAssets();
  await started;
  await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1200, purchaseDate: '2026-03-01' });
  release([{ type: 'bond', assetDetails: { isin: 'TEST', maturityDate: '2027-12-01', prices: { sellUAH: 1100 }, paymentSchedule: [{ date: '2027-06-01', amount: 5000 }, { date: '2027-12-01', amount: 100000 }] } }]);
  await sync;
  const saved = h.local();
  assert.equal(saved.assets[0].quantity, 11);
  assert.equal(saved.assets[0].currentPrice, 1100);
  assert.equal(saved.transactions.filter(tx => tx.type === 'BUY').length, 2);
  assert.equal(saved.payments.find(p => p.type === 'COUPON').amount, 550);
  assert.equal(saved.payments.find(p => p.type === 'MATURITY').amount, 11000);
  await h.drain();
});
function harness({ local = fixture(), remote = clone(local), metadata = true, confirmedStorage = false } = {}) {
  const storage = new Map([['fino-data-v1:test%40example.com', JSON.stringify(local)], ['fino-active-account', 'test@example.com']]);
  if (metadata) storage.set('fino-sync-v2:test%40example.com', JSON.stringify({ baseline: signature(local), pendingUpload: false, conflict: false, error: null }));
  let remoteData = remote, version = 1, offline = false, authOffline = false;
  const files = new Map();
  const uploads = [], backups = [];
  let counter = 0;
  const headers = () => ({ get: (name) => name === 'etag' ? 'version-' + version : null });
  const response = (data, status = 200) => { const capturedVersion = version; return { ok: status >= 200 && status < 300, status, headers: { get: name => name === "etag" ? "version-" + capturedVersion : null }, json: async () => { if (data === "") throw new SyntaxError("Empty JSON"); return clone(data); } }; };
  const hooks = {};
  const fetch = async (url, options = {}) => {
    hooks.driveCalls = (hooks.driveCalls || 0) + 1;
    if (hooks.hangDrive) return new Promise(() => {});
    if (offline) throw new Error('mock offline');
    const parsed = new URL(url);
    if (parsed.hostname === 'www.inzhur.reit') return response(hooks.inzhurCatalog ? await hooks.inzhurCatalog() : []);
    const method = options.method || 'GET';
    let body;
    if (String(options.headers?.['Content-Type'] || '').startsWith('multipart/related')) {
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const parts = options.body.split('--' + boundary).filter(part => part.includes('Content-Type:'));
      body = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
      const snapshot = JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
      if (body.name === 'fino-data.json') {
        if (hooks.failUpload) throw new Error('mock upload failed');
        remoteData = clone(snapshot); version++; uploads.push(clone(snapshot)); return response({ id: 'main' });
      }
      backups.push(clone(snapshot)); return response({ id: 'backup-' + (++counter) });
    }
    body = options.body ? JSON.parse(options.body) : null;
    const id = parsed.pathname.split('/').at(-1);
    if (id === 'main' && parsed.pathname.includes('/upload/') && hooks.failUpload) throw new Error('mock upload failed');
    if (parsed.pathname.includes('/upload/')) {
      if (id === 'main') {
        if (hooks.beforeUpload) { hooks.beforeUpload(); hooks.beforeUpload = null; }
        if (options.headers['If-Match'] && options.headers['If-Match'] !== 'version-' + version) return response({}, 412);
        if (!hooks.dropUpload) { remoteData = clone(body); version++; }
        uploads.push(clone(body));
      } else { files.set(id, clone(body)); backups.push(clone(body)); }
      return response({ id });
    }
    if (method === 'POST' && parsed.pathname.endsWith('/copy')) { backups.push(clone(remoteData)); return response({ id: 'backup-copy-' + (++counter) }); }
    if (method === 'POST') {
      const created = body.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : body.name === 'fino-data.json' ? 'main' : 'backup-' + (++counter);
      if (created === 'main') remoteData = {};
      return response({ id: created });
    }
    if (id === 'folder' && method === 'GET') return response({ id: 'folder', ownedByMe: true, permissions: [{ type: 'user', role: 'owner' }] });
    if (parsed.searchParams.has('q')) return response({ files: parsed.searchParams.get('q').includes('fino-backups') ? [{ id: 'folder' }] : hooks.portfolioFiles || (remoteData ? [{ id: 'main', ownedByMe: true }] : []) });
    if (parsed.searchParams.get('alt') === 'media') { const result = response(remoteData); hooks.afterMedia?.(); return result; }
    if (remoteData === null) return response({}, 404);
    return response({ id: 'main', trashed: false, ownedByMe: !hooks.notOwned, version: String(version), md5Checksum: 'checksum-' + version });
  };
  const preferences = { get: async ({ key }) => { const value = storage.get(key) || null; await hooks.beforePreferenceGet?.(key); return { value }; }, set: async ({ key, value }) => { if (hooks.failPreference?.(key)) throw new Error('mock storage failure'); storage.set(key, value); }, remove: async ({ key }) => storage.delete(key) };
  const auth = { getAccessToken: async () => { if (authOffline || hooks.authFailure?.()) throw new Error('mock authorization offline'); return { email: hooks.authEmail ? hooks.authEmail() : 'test@example.com', accessToken: 'mock' }; }, signOut: async () => {} };
  const context = { window: { Capacitor: { isNativePlatform: () => true, Plugins: { Preferences: preferences, GoogleDriveAuth: auth } } }, fetch, URLSearchParams, console };
  if (confirmedStorage) {
    context.window.Capacitor.Plugins.FinoStorage = preferences;
    context.window.Capacitor.Plugins.Preferences = new Proxy({}, { get() { throw new Error('Async Preferences must not handle confirmed writes.'); } });
  }
  vm.createContext(context);
  for (const script of ['errors', 'sync-model', 'state-contract', 'portfolio/calculations', 'portfolio/normalization', 'portfolio/operations']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/' + script + '.js'), 'utf8'), context);
  }
  context.window.FinoErrors = context.FinoErrors; context.window.FinoSyncModel = context.FinoSyncModel; context.window.FinoStateContract = context.FinoStateContract;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/state-model.js'), 'utf8'), context);
  context.window.FinoStateModel = context.FinoStateModel;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/market-model.js'), 'utf8'), context);
  context.window.FinoMarketModel = context.FinoMarketModel;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/constants.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/validation.js'), 'utf8'), context);
  context.window.FinoConstants = context.FinoConstants;
  context.window.FinoValidation = context.FinoValidation;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/portfolio-rules.js'), 'utf8'), context);
  context.window.FinoPortfolioRules = context.FinoPortfolioRules;
  context.AbortController = AbortController;
  context.crypto = require('node:crypto').webcrypto;
  context.TextEncoder = TextEncoder;
  context.URL = URL;
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/request.js'), 'utf8'), context);
  context.window.FinoRequest = context.FinoRequest;
  vm.runInContext(source, context);
  return { api: context.window.mobileApi, storage, uploads, backups, hooks,
    remote: () => clone(remoteData), changeRemote: (data) => { remoteData = clone(data); version++; }, offline: (value) => { offline = value; }, authOffline: (value) => { authOffline = value; },
    local: () => JSON.parse(storage.get('fino-data-v1:test%40example.com')),
    drain: () => context.window.mobileApi.waitForSync() };
}

test('cached startup reads do not wait for unavailable Drive requests', async () => {
  const h = harness();
  h.hooks.hangDrive = true;
  const data = await h.api.getData({ sync: false });
  assert.equal(data.assets[0].id, 'bond');
  assert.equal(h.hooks.driveCalls || 0, 0);
  assert.equal(h.uploads.length, 0);
});

test('mobile deletion removes all related records and preserves other holdings', async () => {
  const local = fixture();
  local.assets.push({ id: 'other', name: 'Other', type: 'stock', quantity: 1 });
  for (const collection of ['transactions', 'payments', 'sales', 'calendarNotes', 'priceHistory']) {
    local[collection].push({ id: collection + '-bond', assetId: 'bond' }, { id: collection + '-other', assetId: 'other' });
  }
  const h = harness({ local });
  await h.api.getData({ sync: false });
  h.offline(true);
  await h.api.deleteAsset('bond');
  const saved = h.local();
  assert.deepEqual(saved.assets.map(item => item.id), ['other']);
  for (const collection of ['transactions', 'payments', 'sales', 'calendarNotes', 'priceHistory']) {
    assert.deepEqual(saved[collection].map(item => item.assetId), ['other']);
  }
  await assert.rejects(h.api.deleteAsset('missing'), /Asset not found/);
  assert.deepEqual(h.local(), saved);
  await h.drain();
});

test('mobile purchases calculate using the same canonical fields that were validated', async () => {
  for (const purchase of [
    { quantity: 1, purchasePrice: 1200, price: 'invalid', purchaseDate: '2026-03-01', date: '2026-02-01' },
    { quantity: 1, purchasePrice: 1200, price: 500, purchaseDate: '2026-03-01', date: '2026-02-01' },
    { quantity: 1, price: 1200, date: '2026-03-01' },
  ]) {
    const h = harness();
    await h.api.getData({ sync: false });
    h.offline(true);
    const asset = await h.api.buyMoreAsset('bond', purchase);
    assert.equal(asset.quantity, 11);
    assert.equal(asset.purchasePrice, 11200 / 11);
    const transaction = h.local().transactions.at(-1);
    assert.equal(transaction.purchasePrice, 1200);
    assert.equal(transaction.amount, 1200);
    assert.equal(transaction.date, '2026-03-01');
    await h.drain();
  }
});

test('native operations share strict validation and rejected requests preserve the local snapshot', async () => {
  const h = harness();
  await h.api.getData({ sync: false });
  h.offline(true);
  const before = h.local();
  for (const purchase of [
    { quantity: true, purchasePrice: 1000, purchaseDate: '2026-03-01' },
    { quantity: 1, purchasePrice: 'oops', purchaseDate: '2026-03-01' },
    { quantity: 0.5, purchasePrice: 1000, purchaseDate: '2026-03-01' },
    { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-30' },
    { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-03-01', currency: 'USD' },
  ]) {
    await assert.rejects(h.api.buyMoreAsset('bond', purchase));
    assert.deepEqual(h.local(), before);
  }
  await assert.rejects(h.api.createSale({ assetId: 'bond', quantity: 1, sellPrice: 1000, sellDate: '2026-02-30' }));
  await assert.rejects(h.api.saveWallet({ expenses: [{ date: '2026-03-01', category: 'Food', amount: true }], months: {} }));
  await assert.rejects(h.api.syncGoogleDrive('unknown'));
  assert.deepEqual(h.local(), before);
  const bought = await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: '1200', purchaseDate: '2026-03-01' });
  assert.equal(bought.quantity, 11);
  assert.equal(bought.purchasePrice, 11200 / 11);
  await h.drain();
});

test('equal-revision divergent edits produce a conflict without replacing either copy', async () => {
  const h = harness(); await h.api.getData();
  h.offline(true);
  await h.api.createCalendarNote({ assetId: 'bond', date: '2026-03-01', text: 'phone' }); await h.drain();
  const remote = h.remote(); remote.sync.revision = 8; remote.calendarNotes.push({ id: 'desktop-note', text: 'desktop' }); h.changeRemote(remote); h.offline(false);
  const localBefore = h.local();
  await assert.rejects(h.api.syncGoogleDrive(), { code: 'SYNC_CONFLICT' });
  assert.deepEqual(h.local(), localBefore);
  assert.deepEqual(h.remote(), remote);
  const status = await h.api.getGoogleDriveStatus(); assert.equal(status.conflict, true); assert.equal(status.pendingUpload, true);
});
test('a newer remote revision does not replace unsent local changes during getData', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  await h.api.saveWallet({ expenses: [], months: { '2026-03': { budget: 50 } }, loans: [] }); await h.drain();
  const remote = h.remote(); remote.sync.revision = 20; remote.wallet.months = { '2026-04': {} }; h.changeRemote(remote); h.offline(false);
  const result = await h.api.getData(); assert.equal(result.wallet.months['2026-03'].budget, 50); assert.equal(h.uploads.length, 0);
  assert.equal((await h.api.getGoogleDriveStatus()).conflict, true);
});
test('network failures remain pending across restart and never report Synced', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  await h.api.createCalendarNote({ text: 'offline', assetId: 'bond', date: '2026-03-01' }); await h.drain();
  const status = await h.api.getGoogleDriveStatus(); assert.equal(status.connected, false); assert.equal(status.pendingUpload, true); assert.equal(status.errorCode, 'REMOTE_UNAVAILABLE'); assert.notEqual(status.status, 'Synced');
  assert.equal(JSON.parse(h.storage.get('fino-sync-v2:test%40example.com')).pendingUpload, true);
  const restarted = harness({ local: h.local(), remote: h.remote(), metadata: false });
  restarted.storage.set('fino-sync-v2:test%40example.com', h.storage.get('fino-sync-v2:test%40example.com'));
  await restarted.api.syncGoogleDrive(); assert.equal(restarted.remote().calendarNotes[0].text, 'offline'); assert.equal((await restarted.api.getGoogleDriveStatus()).pendingUpload, false);
});
test('offline authorization still allows reading and saving the last local account', async () => {
  const h = harness(); h.authOffline(true);
  const data = await h.api.getData(); assert.equal(data.assets[0].id, 'bond');
  await h.api.createCalendarNote({ text: 'offline account', assetId: 'bond', date: '2026-03-01' }); await h.drain();
  assert.equal(h.local().calendarNotes[0].text, 'offline account'); assert.notEqual((await h.api.getGoogleDriveStatus()).status, 'Synced');
});
test('manual backup creates a separate file and does not update the primary portfolio', async () => {
  const h = harness(); await h.api.getData(); const before = h.remote();
  await h.api.syncGoogleDrive('backup'); assert.equal(h.backups.length, 1); assert.deepEqual(h.backups[0], h.local()); assert.deepEqual(h.remote(), before); assert.equal(h.uploads.length, 0);
});
test('explicit download backs up local changes before replacing them', async () => {
  const h = harness(); await h.api.getData(); h.offline(true); await h.api.createCalendarNote({ text: 'local recovery', assetId: 'bond', date: '2026-03-01' }); await h.drain(); h.offline(false);
  const before = h.local(); const remote = h.remote(); remote.sync.revision = 8; remote.calendarNotes = [{ id: 'other', text: 'remote' }]; h.changeRemote(remote);
  await h.api.syncGoogleDrive('download'); assert.deepEqual(h.backups.at(-1), before); assert.equal(h.local().calendarNotes[0].text, 'remote'); assert.equal((await h.api.getGoogleDriveStatus()).pendingUpload, false);
});
test('a failed backup prevents destructive download', async () => {
  const h = harness(); await h.api.getData(); const before = h.local(); h.offline(true);
  await assert.rejects(h.api.syncGoogleDrive('download'), /offline/); assert.deepEqual(h.local(), before);
});
test('explicit upload backs up the remote version first', async () => {
  const h = harness(); await h.api.getData(); h.offline(true); await h.api.createCalendarNote({ text: 'local', assetId: 'bond', date: '2026-03-01' }); await h.drain(); h.offline(false);
  const remote = h.remote(); remote.calendarNotes = [{ id: 'other', text: 'remote recovery' }]; remote.sync.revision = 9; h.changeRemote(remote);
  await h.api.syncGoogleDrive('upload'); assert.deepEqual(h.backups.at(-1), remote); assert.equal(h.remote().calendarNotes[0].text, 'local');
});
test('conditional upload detects a remote edit made after the initial read', async () => {
  const h = harness(); await h.api.getData();
  h.hooks.beforeUpload = () => { const remote = h.remote(); remote.calendarNotes.push({ id: 'race', text: 'concurrent' }); h.changeRemote(remote); };
  await h.api.createCalendarNote({ text: 'phone', assetId: 'bond', date: '2026-03-01' }); await h.drain();
  assert.equal((await h.api.getGoogleDriveStatus()).conflict, true); assert.equal(h.remote().calendarNotes[0].text, 'concurrent'); assert.equal(h.local().calendarNotes[0].text, 'phone');
});
test('concurrent mutations are persisted and uploaded in order', async () => {
  const h = harness(); await h.api.getData();
  await Promise.all(Array.from({ length: 10 }, (_, i) => h.api.createCalendarNote({ text: 'note ' + i, assetId: 'bond', date: '2026-03-01' }))); await h.drain();
  assert.equal(h.local().calendarNotes.length, 10); assert.equal(h.remote().calendarNotes.length, 10); assert.equal((await h.api.getGoogleDriveStatus()).pendingUpload, false);
});
test('clean devices adopt remote changes without relying on revision ordering', async () => {
  const h = harness(); await h.api.getData(); const remote = h.remote(); remote.sync.revision = 7; remote.calendarNotes.push({ id: 'other', text: 'desktop edit' }); h.changeRemote(remote);
  assert.equal((await h.api.getData()).calendarNotes[0].text, 'desktop edit'); assert.equal(h.uploads.length, 0);
});
test('closed or redeemed bonds cannot be sold, and maturity closes the holding', async () => {
  for (const marker of ['closedAt', 'received', 'paid']) {
    const local = fixture();
    if (marker === 'closedAt') local.assets[0].closedAt = '2026-02-01';
    else local.payments.push({ id: 'maturity', assetId: 'bond', type: 'MATURITY', status: marker, amount: 10000 });
    const h = harness({ local });
    await assert.rejects(h.api.createSale({ assetId: 'bond', quantity: 1, sellPrice: 1000, sellDate: '2026-03-01' }), /Not enough/);
    assert.equal(h.local().sales.length, 0);
  }
  const local = fixture(); local.payments.push({ id: 'maturity', assetId: 'bond', type: 'MATURITY', status: 'planned', amount: 10000 });
  const h = harness({ local }); await h.api.markPaymentReceived('maturity'); await h.drain();
  assert.ok(h.local().assets[0].closedAt); await h.api.markPaymentReceived('maturity'); await h.drain(); assert.equal(h.local().transactions.filter(tx => tx.paymentId === 'maturity').length, 1);
});
test('failed mutations do not leave partial changes in local storage', async () => {
  const h = harness(); const before = h.local();
  await assert.rejects(h.api.createSale({ assetId: 'bond', quantity: 1.5, sellPrice: 1000, sellDate: '2026-03-01' }), /whole number/);
  assert.deepEqual(h.local(), before);
});

test('legacy installations with unknown sync history never overwrite differing remote data', async () => {
  const local = fixture(); const remote = fixture(); remote.calendarNotes.push({ id: 'other', text: 'desktop history' });
  const h = harness({ local, remote, metadata: false }); await h.api.getData();
  assert.deepEqual(h.remote(), remote); assert.equal(h.uploads.length, 0); assert.equal((await h.api.getGoogleDriveStatus()).conflict, true);
});
test('corrupted local JSON is reported instead of replaced with an empty portfolio', async () => {
  const h = harness(); h.storage.set('fino-data-v1:test%40example.com', '{invalid');
  await assert.rejects(h.api.getData(), /corrupted/); assert.equal(h.storage.get('fino-data-v1:test%40example.com'), '{invalid'); assert.equal(h.uploads.length, 0);
});

test('first upload retries safely after an interrupted multipart creation', async () => {
  const h = harness({ remote: null }); h.hooks.failUpload = true;
  await assert.rejects(h.api.syncGoogleDrive('upload'), /failed/);
  h.hooks.failUpload = false;
  await h.api.syncGoogleDrive('upload');
  assert.equal(h.remote().assets[0].id, 'bond');
});
test('invalid remote structure cannot mark a corrupt local snapshot usable on a later request', async () => {
  const h = harness(); h.storage.set('fino-data-v1:test%40example.com', '{"assets":"broken"}');
  await assert.rejects(h.api.getData());
  await assert.rejects(h.api.getData());
});

test('explicit upload can recover a legacy empty Drive file after backing it up', async () => {
  const h = harness({ remote: {} });
  await h.api.syncGoogleDrive('upload');
  assert.deepEqual(h.backups[0], {}); assert.equal(h.remote().assets[0].id, 'bond');
});
test('an account switch during an upload cannot send one account portfolio to another account', async () => {
  const h = harness(); await h.api.getData(); let calls = 0;
  h.hooks.authEmail = () => ++calls === 1 ? 'test@example.com' : 'other@example.com';
  await assert.rejects(h.api.syncGoogleDrive('upload'), /account changed/i);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.storage.get('fino-data-v1:other%40example.com'), undefined);
});

test('an account switch after offline fallback aborts the same operation', async () => {
  const h = harness(); let calls = 0;
  h.hooks.authFailure = () => ++calls === 1;
  h.hooks.authEmail = () => 'other@example.com';
  await assert.rejects(h.api.syncGoogleDrive('upload'), /account changed/i);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.storage.get('fino-data-v1:other%40example.com'), undefined);
});
test('malformed wallet collections are rejected without replacing local data', async () => {
  const h = harness(); const broken = fixture(); broken.wallet.expenses = {};
  const raw = JSON.stringify(broken); h.storage.set('fino-data-v1:test%40example.com', raw);
  await assert.rejects(h.api.getData()); await assert.rejects(h.api.getData());
  assert.equal(h.storage.get('fino-data-v1:test%40example.com'), raw);
});

test('collection reads cannot restore stale cached data over concurrent local mutations', async () => {
  for (const method of ['getSales', 'getTransactions', 'getPayments', 'getCalendarNotes']) {
    const h = harness(); h.offline(true);
    h.hooks.beforePreferenceGet = async (key) => {
      if (key === 'fino-data-v1:test%40example.com') await new Promise(setImmediate);
    };
    await Promise.all([
      h.api[method](),
      h.api.createCalendarNote({ text: 'first', assetId: 'bond', date: '2026-03-01' }),
    ]);
    await h.api.createCalendarNote({ text: 'second', assetId: 'bond', date: '2026-03-01' });
    await h.drain();
    assert.deepEqual(h.local().calendarNotes.map(note => note.text), ['first', 'second'], method);
  }
});
