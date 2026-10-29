// Build-time guardrails only. Existing browser owners remain in frontend-globals.json.
const { owners: sharedOwners } = require('./backend/scripts/sharedBrowserModules.cjs');
const readonly = names => Object.fromEntries(names.map(name => [name, 'readonly']));
const browser = readonly(['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'fetch', 'URL', 'URLSearchParams', 'FormData', 'AbortController', 'TextEncoder', 'TextDecoder', 'crypto', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'structuredClone', 'getComputedStyle', 'NodeFilter', 'Blob', 'FileReader']);
const node = readonly(['require', 'module', 'exports', 'process', 'Buffer', '__dirname', '__filename']);
const rules = { 'no-undef': 'error', 'no-global-assign': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-const-assign': 'error', 'no-unreachable': 'error', 'valid-typeof': 'error', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-duplicate-case': 'error', 'no-sparse-arrays': 'error' };
const financial = { rules: { 'no-financial-state-mutation': require('./backend/scripts/lint/noFinancialStateMutation.cjs') } };
module.exports = [
  { ignores: ['node_modules/**', '.tmp/**', 'android/**', 'frontend/**/vendor/**', 'shared/**/vendor/**', 'frontend/js/**/*.generated.js', 'shared/**/*.generated.js'] },
  { files: ['shared/**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...node, ...browser, ...readonly(Object.keys(sharedOwners)) } }, rules },
  { files: ['frontend/js/**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: browser }, rules },
  { files: ['frontend/js/**/*.js'], ignores: ['frontend/js/state-store.js', 'frontend/js/mobile-api.js'], plugins: { financial }, rules: { 'financial/no-financial-state-mutation': ['error', { banLegacyReads: true }] } },
];
