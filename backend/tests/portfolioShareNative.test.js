const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../../frontend/js/share-card/platform');
const name = 'fino-portfolio-2026-10-21.png';
// Minimal header for JS transport checks. Full CRC/chunk/inflate validation is
// independently exercised against real synthetic PNGs by the Java tests.
function image() {
  const bytes = new Uint8Array(64); bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer); view.setUint32(16, 1080); view.setUint32(20, 1080);
  return new Blob([bytes], { type: 'image/png' });
}
class Reader {
  readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { if (!this.aborted) { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64'); this.onload?.(); } }); }
  abort() { this.aborted = true; this.onabort?.(); }
}
function setup(plugin, extra = {}) {
  const window = { Blob, File, FileReader: Reader, navigator: { share() { assert.fail('Native path used browser share'); } }, Capacitor: { isNativePlatform: () => true, isPluginAvailable: id => id === 'PortfolioShare', Plugins: { PortfolioShare: plugin } }, ...extra };
  const document = { createElement() { assert.fail('Native path created browser download'); } };
  return { adapter: platform.create({ window, document }), window, document };
}
const saved = { status: 'saved', saved: true, cancelled: false };
const shared = { status: 'dialog-closed', opened: true, deliveryConfirmed: false };
test('Capacitor PNG bridge saves and shares only bounded PNG payloads, preserving neutral names and truthful statuses', async () => {
  const calls = [];
  const plugin = { savePng: async payload => { calls.push(['save', payload]); return saved; }, sharePng: async payload => { calls.push(['share', payload]); return shared; } };
  const { adapter } = setup(plugin);
  assert.equal(adapter.native, true); assert.equal(adapter.supported, true);
  assert.equal(await adapter.download(image(), name), saved);
  assert.equal(await adapter.share(image(), { name }), shared);
  for (const [, payload] of calls) {
    assert.deepEqual(Object.keys(payload).sort(), ['base64', 'mimeType', 'name']); assert.equal(payload.mimeType, 'image/png'); assert.equal(payload.name, name);
    assert.equal(Buffer.from(payload.base64, 'base64').length, 64);
  }
  assert.deepEqual(calls.map(call => call[0]), ['save', 'share']);
});
test('native plugin detection is capability-based, disables old APK export and never falls back to web APIs', () => {
  for (const plugin of [null, {}, { savePng() {} }]) assert.equal(setup(plugin).adapter.supported, false);
  const plugin = { savePng() {}, sharePng() {} };
  assert.equal(setup(plugin, { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false, Plugins: { PortfolioShare: plugin } } }).adapter.supported, false);
  assert.equal(setup(plugin, { Capacitor: { isNativePlatform: () => false, Plugins: { PortfolioShare: plugin } } }).adapter.native, false);
  assert.equal(setup(null, { Capacitor: null, mobileApi: {} }).adapter.supported, false);
  assert.throws(() => setup(null).adapter.download(image(), name), /unavailable/);
});
test('native transport rejects invalid MIME, empty/oversized data, bad PNG signatures/dimensions and unsafe names before bridge invocation', async () => {
  let calls = 0; const h = setup({ savePng: async () => { calls++; return saved; }, sharePng: async () => shared });
  for (const blob of [new Blob([], { type: 'image/png' }), new Blob(['no png'], { type: 'image/png' }), new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), new Blob([await image().arrayBuffer()], { type: 'image/jpeg' }), new Blob([new Uint8Array(64)], { type: 'image/png' })]) await assert.rejects(h.adapter.download(blob, name), /Invalid PNG/);
  const bytes = new Uint8Array(await image().arrayBuffer()); new DataView(bytes.buffer).setUint32(16, 500);
  await assert.rejects(h.adapter.download(new Blob([bytes], { type: 'image/png' }), name), /Invalid PNG/);
  for (const unsafe of ['../' + name, 'private-assets.png', 'fino-portfolio-2026-02-31.png', 'fino-portfolio-2026-10-21.png/other']) await assert.rejects(h.adapter.download(image(), unsafe), /Invalid PNG/);
  assert.equal(calls, 0);
});
test('native cancellation/errors do not claim success and permit retry; unconfirmed replies are rejected', async () => {
  const plugin = { savePng: async () => ({ status: 'cancelled', cancelled: true, saved: false }), sharePng: async () => shared };
  const { adapter } = setup(plugin);
  assert.equal((await adapter.download(image(), name)).cancelled, true);
  plugin.savePng = async () => { throw Object.assign(new Error('Private internal details'), { code: 'STORAGE_FAILURE' }); };
  await assert.rejects(adapter.download(image(), name), { code: 'STORAGE_FAILURE' });
  for (const invalid of [null, { success: true }, { status: 'saved', saved: false }, { status: 'cancelled', cancelled: false }]) {
    plugin.savePng = async () => invalid; await assert.rejects(adapter.download(image(), name), /not confirmed/);
  }
  plugin.sharePng = async () => ({ status: 'dialog-closed', opened: true, deliveryConfirmed: true });
  await assert.rejects(adapter.share(image(), { name }), /not confirmed/);
  plugin.savePng = async () => saved; assert.equal(await adapter.download(image(), name), saved);
});
test('one PNG operation per plugin even across modal instances; stale and aborted preparation never opens a native dialog', async () => {
  let resolve, calls = 0;
  const plugin = { savePng: payload => { calls++; return new Promise(done => { resolve = done; }); }, sharePng: async () => shared };
  const h = setup(plugin), other = platform.create(h);
  const pending = h.adapter.download(image(), name);
  await assert.rejects(other.share(image(), { name }), { code: 'CONFLICT' });
  while (!resolve) await new Promise(setImmediate);
  assert.equal(calls, 1); resolve(saved); await pending;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.adapter.download(image(), name, { signal: controller.signal }), { name: 'AbortError' });
  const duringRead = new AbortController();
  h.window.FileReader = class extends Reader { readAsDataURL() { queueMicrotask(() => duringRead.abort()); } };
  await assert.rejects(h.adapter.download(image(), name, { signal: duringRead.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('explicit native bridge injection remains supported without changing browser download/share contracts', async () => {
  const result = [], nativeBridge = { download: (...args) => result.push(args), share: (...args) => result.push(args) };
  const { window, document } = setup(null);
  const adapter = platform.create({ window, document, nativeBridge });
  const blob = image(); await adapter.download(blob, name); await adapter.share(blob);
  assert.equal(result[0][0], blob); assert.equal(result[0][1], name); assert.equal(result[1][0], blob);
});
