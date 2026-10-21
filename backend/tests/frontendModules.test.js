const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { manifest, sourcePath, validateFrontend, validateBindings, assertReviewedGlobals } = require('../scripts/frontendContract');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');

test('frontend scripts exist and compile together in their HTML loading order', () => {
  const files = validateFrontend(html);
  assert.ok(files.length > 20);
  const sources = files.map(file => fs.readFileSync(sourcePath(file), 'utf8'));
  // Classic scripts share a lexical scope; this also catches duplicate bindings.
  assert.doesNotThrow(() => new vm.Script(sources.join('\n;\n')));
});

function browserContext() {
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
  return { context, listeners };
}
function loadScripts(context, skip) {
  for (const script of manifest.scripts) {
    if (script.src === skip) continue;
    const before = Object.getOwnPropertyDescriptors(context);
    vm.runInContext(fs.readFileSync(sourcePath(script.src), 'utf8'), context, { filename: script.src });
    assertReviewedGlobals(script, before, Object.getOwnPropertyDescriptors(context));
  }
}
test('real local scripts execute in HTML order with only reviewed globals and register startup', () => {
  const { context, listeners } = browserContext();
  assert.doesNotThrow(() => loadScripts(context));
  assert.ok(listeners.some(([event, callback]) => event === 'DOMContentLoaded' && callback === context.init));
  assert.equal(context.ui.application.init, context.init);
  assert.equal(context.ui.application.loadData, context.loadData);
  assert.equal(vm.runInContext('stateStore.selectData().schemaVersion', context), 1);
  assert.equal(vm.runInContext('typeof state', context), 'undefined');
  assert.equal(vm.runInContext('typeof api.getData', context), 'function');
  // A missing optional local chart resource must still allow the UI fallback.
  context.Chart = undefined;
  context.document.querySelector = () => ({});
  assert.doesNotThrow(() => context.renderAssetAllocationChart());
  assert.doesNotThrow(() => context.renderPortfolioHistoryChart());
  assert.doesNotThrow(() => context.macroLineChart('inflation', [], 'CPI', '#fff'));
  assert.doesNotThrow(() => context.macroMultiChart('gdp', [], []));
  assert.doesNotThrow(() => context.renderWalletCharts());
});

test('loading contract rejects missing, reordered, remote, deferred and inline scripts', () => {
  const first = '<script src="/shared/errors.js"></script>';
  const second = '<script src="/shared/operations.js"></script>';
  for (const broken of [
    html.replace(first, ''),
    html.replace(first, `<!-- ${first} -->`),
    html.replace(first, '__FIRST_SCRIPT__').replace(second, first).replace('__FIRST_SCRIPT__', second),
    html.replace('/shared/errors.js', 'https://example.test/errors.js'),
    html.replace(first, '<script async src="/shared/errors.js"></script>'),
    html.replace(first, '<script>window.unreviewed = true;</script>'),
  ]) assert.throws(() => validateFrontend(broken));
});

test('global contract catches new lexical, destructured, function, class and property globals', () => {
  const script = { src: '/js/example.js', globals: [], bindings: [] };
  for (const source of ['const leaked = 1;', 'const { leak } = {};', 'let neverInitialized;', 'var loose;', 'function helper() {}', 'class Example {}', 'const нове = 1;']) {
    assert.throws(() => validateBindings(source, script), /Unreviewed global/);
  }
  assert.doesNotThrow(() => validateBindings('(function () { const scoped = 1; })();', script));
  assert.doesNotThrow(() => validateBindings('const reviewed = 1;', { ...script, bindings: ['reviewed'] }));
  const context = vm.createContext({ existing: 1 });
  const before = Object.getOwnPropertyDescriptors(context);
  vm.runInContext('globalThis.leak = 2; globalThis.existing = 3;', context);
  assert.throws(() => assertReviewedGlobals(script, before, Object.getOwnPropertyDescriptors(context)), /Unreviewed browser globals/);
});

test('omitting a model or late bootstrap dependency makes real frontend loading fail', () => {
  for (const missing of ['/shared/state-model.js', '/js/controllers/application.js']) {
    const { context } = browserContext();
    assert.throws(() => loadScripts(context, missing), /(?:isDate|renderApplication)/);
  }
});

test('every global and classic binding has one responsible module', () => {
  const owners = new Map();
  for (const script of manifest.scripts) {
    for (const name of new Set([...script.globals, ...script.bindings])) {
      assert.ok(!owners.has(name), `${name} has more than one owner`);
      owners.set(name, script.src);
    }
  }
});
