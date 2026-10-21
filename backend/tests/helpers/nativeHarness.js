const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../../frontend/js/mobile-api.js'), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const signature = (value) => JSON.stringify((function canonical(item) { return Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item; })(value));
const fixture = () => ({ schemaVersion: 1, sync: { revision: 7, updatedAt: '2026-01-01T00:00:00Z', deviceId: 'desktop' }, assets: [{ id: 'bond', name: 'Bond', type: 'ovdp', quantity: 10, remainingQuantity: 10, remainingCostBasis: 10000, purchasePrice: 1000, currency: 'UAH' }], transactions: [{ id: 'buy', assetId: 'bond', type: 'BUY', quantity: 10, amount: 10000, date: '2026-01-01' }], sales: [], payments: [], calendarNotes: [], priceHistory: [], wallet: { expenses: [], months: {}, loans: [] }, instruments: [] });

function harness({ local = fixture(), remote = clone(local), metadata = true, confirmedStorage = false, proxy = false, storage: restoredStorage } = {}) {
  const storage = restoredStorage || new Map([['fino-data-v1:test%40example.com', JSON.stringify(local)], ['fino-active-account', 'test@example.com']]);
  if (metadata && !restoredStorage) storage.set('fino-sync-v2:test%40example.com', JSON.stringify({ baseline: signature(local), pendingUpload: false, conflict: false, error: null }));
  let remoteData = remote, version = 1, offline = false, authOffline = false;
  const files = new Map();
  const uploads = [], backups = [];
  let counter = 0;
  const headers = () => ({ get: (name) => name === 'etag' ? 'version-' + version : null });
  const response = (data, status = 200) => { const capturedVersion = version; return { ok: status >= 200 && status < 300, status, headers: { get: name => name === "etag" ? "version-" + capturedVersion : null }, text: async () => typeof data === 'string' ? data : JSON.stringify(data), json: async () => { if (data === "") throw new SyntaxError("Empty JSON"); return clone(data); } }; };
  const hooks = {};
  const fetch = async (url, options = {}) => {
    hooks.driveCalls = (hooks.driveCalls || 0) + 1;
    if (hooks.hangDrive) return new Promise(() => {});
    if (offline) throw new Error('mock offline');
    const parsed = new URL(url);
    if (parsed.hostname === 'www.googleapis.com') await hooks.beforeDriveRequest?.(parsed, options);
    if (hooks.externalFetch && ['bank.gov.ua', 'stat.gov.ua', 'script.google.com'].includes(parsed.hostname)) return hooks.externalFetch(parsed, options);
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
  const auth = { getAccessToken: async () => { hooks.authCalls = (hooks.authCalls || 0) + 1; if (hooks.hangAuth) return new Promise(() => {}); if (authOffline || hooks.authFailure?.()) throw new Error('mock authorization offline'); return { email: hooks.authEmail ? hooks.authEmail() : 'test@example.com', accessToken: 'mock' }; }, signOut: async () => {} };
  const context = { window: { Capacitor: { isNativePlatform: () => true, Plugins: { Preferences: preferences, GoogleDriveAuth: auth } } }, fetch, URLSearchParams, console };
  if (proxy) context.window.FINO_MOBILE_CONFIG = { proxyUrl: 'https://script.google.com/macros/s/mock/exec', proxyToken: 'mock-token' };
  if (confirmedStorage) {
    context.window.Capacitor.Plugins.FinoStorage = preferences;
    context.window.Capacitor.Plugins.Preferences = new Proxy({}, { get() { throw new Error('Async Preferences must not handle confirmed writes.'); } });
  }
  vm.createContext(context);
  for (const script of ['errors', 'operations', 'sync-model', 'state-contract', 'portfolio/calculations', 'portfolio/normalization', 'portfolio/operations']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/' + script + '.js'), 'utf8'), context);
  }
  context.window.FinoErrors = context.FinoErrors; context.window.FinoOperations = context.FinoOperations; context.window.FinoSyncModel = context.FinoSyncModel; context.window.FinoStateContract = context.FinoStateContract;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/state-model.js'), 'utf8'), context);
  context.window.FinoStateModel = context.FinoStateModel;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/portfolio-transfer.js'), 'utf8'), context);
  context.window.FinoPortfolioTransfer = context.FinoPortfolioTransfer;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/market-model.js'), 'utf8'), context);
  context.window.FinoMarketModel = context.FinoMarketModel;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/constants.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/validation.js'), 'utf8'), context);
  context.window.FinoConstants = context.FinoConstants;
  context.window.FinoValidation = context.FinoValidation;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/portfolio/validation.js'), 'utf8'), context);
  context.window.FinoOperationValidation = context.FinoOperationValidation;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/portfolio-rules.js'), 'utf8'), context);
  context.window.FinoPortfolioRules = context.FinoPortfolioRules;
  context.AbortController = AbortController;
  context.crypto = require('node:crypto').webcrypto;
  context.TextEncoder = TextEncoder;
  context.URL = URL;
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../shared/request.js'), 'utf8'), context);
  context.window.FinoRequest = context.FinoRequest;
  vm.runInContext(source, context);
  return { api: context.window.mobileApi, storage, uploads, backups, hooks,
    remote: () => clone(remoteData), changeRemote: (data) => { remoteData = clone(data); version++; }, offline: (value) => { offline = value; }, authOffline: (value) => { authOffline = value; },
    local: () => JSON.parse(storage.get('fino-data-v1:test%40example.com')),
    drain: () => context.window.mobileApi.waitForSync() };
}

module.exports={harness,fixture,clone};
