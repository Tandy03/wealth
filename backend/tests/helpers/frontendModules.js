const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bundlePath = path.resolve(__dirname, '../../../.tmp/frontend-test/modules.js');
let bundle;
function loadModules(context) {
  bundle ||= fs.readFileSync(bundlePath, 'utf8');
  vm.runInContext(bundle, context, { filename: 'frontend-modules.test-bundle.js' });
  return context.FinoTestModules || vm.runInContext('FinoTestModules', context);
}
// Test-only facade for the existing UI assertions. It never assigns application
// services to the real Window, and dependencies come from ESM imports, not a manifest.
function exposeRuntime(window, runtime, context) {
  const facade = new Proxy(window, {
    get(target, key) {
      if (key in runtime && (!(key in target) || key === 'Chart')) return runtime[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' && typeof key === 'string' && /^[a-z]/.test(key) ? value.bind(target) : value;
    },
    set(target, key, value) { if (key in runtime && (!(key in target) || key === 'Chart')) runtime[key] = value; else Reflect.set(target, key, value, target); return true; },
  });
  const scope = Object.create(runtime);
  Object.defineProperty(scope, 'window', { value: facade });
  const evaluate = vm.runInContext('(function (scope, expression) { with (scope) { return eval(expression); } })', context);
  return { window: facade, eval: expression => evaluate(scope, expression) };
}
module.exports = { loadModules, exposeRuntime };
