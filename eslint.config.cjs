// Build-time guardrails only. Existing browser owners remain in frontend-globals.json.
const contract = require('./frontend-globals.json');
const readonly = names => Object.fromEntries(names.map(name => [name, 'readonly']));
const browser = readonly(['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URL', 'URLSearchParams', 'FormData', 'AbortController', 'TextEncoder', 'TextDecoder', 'crypto', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'structuredClone']);
const node = readonly(['require', 'module', 'exports', 'process', 'Buffer', '__dirname', '__filename']);
const owners = readonly(contract.scripts.flatMap(script => [...script.globals, ...(script.bindings || [])]));
const rules = { 'no-undef': 'error', 'no-global-assign': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-const-assign': 'error', 'no-unreachable': 'error', 'valid-typeof': 'error', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-duplicate-case': 'error', 'no-sparse-arrays': 'error' };
module.exports = [
  { ignores: ['node_modules/**', '.tmp/**', 'android/**', 'frontend/vendor/**', 'frontend/js/mobile-config.generated.js'] },
  { files: ['shared/**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...node, ...browser, ...readonly(contract.scripts.filter(s => s.src.startsWith('/shared/')).flatMap(s => s.globals)) } }, rules },
  { files: ['frontend/js/**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...node, ...browser, ...owners } }, rules },
];
