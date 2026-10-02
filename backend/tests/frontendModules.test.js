const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('frontend scripts exist and compile together in their HTML loading order', () => {
  const frontend = path.join(__dirname, '../../frontend');
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="(\/js\/[^"?]+)(?:\?[^"\s]*)?"/g)].map(match => match[1]);
  assert.ok(files.length > 20);
  const sources = files.map(file => fs.readFileSync(path.join(frontend, file), 'utf8'));
  // Classic scripts share a lexical scope; this also catches duplicate bindings.
  assert.doesNotThrow(() => new vm.Script(sources.join('\n;\n')));
});

test('frontend scripts execute in HTML order and register application startup', () => {
  const frontend = path.join(__dirname, '../../frontend');
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="(\/js\/[^"?]+)(?:\?[^"\s]*)?"/g)].map(match => match[1]);
  const listeners = [];
  const storage = new Map();
  const context = {
    console, URL, URLSearchParams, Intl, setTimeout, clearTimeout,
    location: { protocol: 'https:', hostname: 'localhost' },
    navigator: { language: 'en' },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { addEventListener: (event, callback) => listeners.push([event, callback]), querySelector: () => null, querySelectorAll: () => [], documentElement: { lang: 'en' } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
  };
  context.window = context;
  vm.createContext(context);
  for (const file of files) assert.doesNotThrow(() => vm.runInContext(fs.readFileSync(path.join(frontend, file), 'utf8'), context, { filename: file }), file);
  assert.ok(listeners.some(([event, callback]) => event === 'DOMContentLoaded' && callback === context.init));
  assert.equal(vm.runInContext('state.data.schemaVersion', context), 1);
  assert.equal(vm.runInContext('typeof api.getData', context), 'function');
  // CDN failure leaves real canvases in the document, but no Chart global.
  context.document.querySelector = () => ({});
  assert.doesNotThrow(() => context.renderAssetAllocationChart());
  assert.doesNotThrow(() => context.renderPortfolioHistoryChart());
  assert.doesNotThrow(() => context.macroLineChart('inflation', [], 'CPI', '#fff'));
  assert.doesNotThrow(() => context.macroMultiChart('gdp', [], []));
  assert.doesNotThrow(() => context.renderWalletCharts());
});
