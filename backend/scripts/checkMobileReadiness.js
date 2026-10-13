// Read-only preflight: never copies Android assets, packages an APK or prints secrets.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
require('../config/loadEnv');

const root = path.resolve(__dirname, '../..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}
async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  assert.equal(config.appId, 'com.tandy03.fino', 'Unexpected Android application ID.');
  assert.equal(config.webDir, 'frontend', 'Unexpected web asset directory.');
  assert.equal(config.server.androidScheme, 'https', 'WebCrypto requires the HTTPS native origin.');
  assert.ok(!config.server.url, 'Native build must load its bundled assets.');
  assert.equal(config.android.allowMixedContent, false);
  const frontend = path.join(root, config.webDir);
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  let references = 0;
  for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
    const target = path.resolve(frontend, '.' + match[1]);
    assert.ok(target.startsWith(frontend + path.sep), 'Asset path escapes the frontend.');
    assert.ok(fs.statSync(target).isFile(), 'A referenced frontend asset is missing.');
    references++;
  }
  const scripts = [...files(path.join(root, 'backend')), ...files(frontend)].filter(file => file.endsWith('.js'));
  for (const file of [...scripts, path.join(root, 'apps-script/Code.gs')]) {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) });
  }
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(frontend, 'js/mobile-config.generated.js'), 'utf8'), context, { timeout: 1000 });
  const proxy = context.window.FINO_MOBILE_CONFIG;
  assert.ok(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(proxy?.proxyUrl), 'Proxy configuration is invalid.');
  assert.ok(typeof proxy.proxyToken === 'string' && proxy.proxyToken.length >= 32, 'Proxy token is missing or invalid.');
  assert.ok(proxy.proxyUrl === String(process.env.FINO_PROXY_URL || '').trim() && proxy.proxyToken === String(process.env.FINO_PROXY_TOKEN || '').trim(), 'Generated mobile configuration is stale. Run npm.cmd run mobile:config.');
  const activity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/tandy03/fino/MainActivity.java'), 'utf8');
  for (const plugin of ['GoogleDriveAuthPlugin', 'AppLockPlugin', 'FinoStoragePlugin']) {
    assert.ok(activity.includes('registerPlugin(' + plugin + '.class)'), 'A required Android plugin is not registered.');
  }
  console.log(`Mobile preflight passed: ${references} asset references, ${scripts.length + 1} JavaScript sources, native configuration and plugin registration.`);
  console.log('Generated proxy configuration matches the build environment. Secret values were not printed.');
  if (process.argv.includes('--live-proxy')) {
    const { fetchWithTimeout } = require('../../frontend/js/request');
    const response = await fetchWithTimeout(proxy.proxyUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: proxy.proxyToken, action: 'health' }),
    }, { timeoutMs: 20000 });
    const payload = await response.json();
    assert.ok(response.ok && payload?.ok === true && payload.data?.service === 'fino-market-proxy', 'Live proxy authentication or health check failed.');
    console.log('Live market proxy authenticated health check passed. No deployment was changed.');
  }
}
main().catch(error => {
  // Never print a provider URL, request body, stack or arbitrary upstream message.
  const message = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Mobile preflight failed; check local files or network availability.';
  console.error(message);
  process.exitCode = 1;
});
