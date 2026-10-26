// Read-only preflight: never copies Android assets, packages an APK or prints secrets.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { verifyAssets } = require('./mobileAssets');
const { validateFrontend } = require('./frontendContract');
const espree = require('espree');
const { pathToFileURL } = require('node:url');
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
  assert.equal(config.webDir, '.tmp/mobile-web', 'Unexpected web asset directory.');
  assert.equal(config.server.androidScheme, 'https', 'WebCrypto requires the HTTPS native origin.');
  assert.ok(!config.server.url, 'Native build must load its bundled assets.');
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.loggingBehavior, 'none', 'Native bridge payload logging must be disabled for financial records.');
  const frontend = path.join(root, 'frontend');
  const bundle = path.join(root, config.webDir);
  const entries = verifyAssets(root, bundle);
  const graph = validateFrontend();
  const sharedEntries = graph.files.filter(file => file.startsWith(path.join(root, 'shared') + path.sep));
  assert.ok(sharedEntries.length >= 13, 'Shared implementations are missing from the module graph.');
  const scriptsConfig = require('../../package.json').scripts;
  assert.ok(scriptsConfig['mobile:sync'].includes('mobile:prepare'), 'Android sync must prepare local resources.');
  assert.equal(scriptsConfig['capacitor:copy:before'], 'npm run mobile:prepare', 'Capacitor copy must refresh local resources.');
  const html = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8');
  assert.equal([...html.matchAll(/<script\b/g)].length, 1, 'The mobile page must load one bundled module.');
  assert.match(html, /<script\b[^>]*type="module"/);
  let references = 0;
  for (const match of html.matchAll(/(?:src|href)="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
    const target = path.resolve(bundle, '.' + match[1]);
    assert.ok(target.startsWith(bundle + path.sep), 'Asset path escapes the Android web bundle.');
    assert.ok(fs.statSync(target).isFile(), 'A referenced frontend asset is missing.');
    references++;
  }
  const scripts = [...files(path.join(root, 'backend')), ...files(frontend), ...files(path.join(root, 'shared'))].filter(file => file.endsWith('.js'));
  for (const file of [...scripts, path.join(root, 'apps-script/Code.gs')]) {
    if (file.startsWith(frontend + path.sep)) espree.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    else new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) });
  }
  const proxy = (await import(pathToFileURL(path.join(frontend, 'js/mobile-config.generated.js')).href)).default;
  const configured = Boolean(proxy?.proxyUrl || proxy?.proxyToken);
  if (configured) {
    assert.ok(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(proxy?.proxyUrl), 'Proxy configuration is invalid.');
    assert.ok(typeof proxy.proxyToken === 'string' && proxy.proxyToken.length >= 32, 'Proxy token is missing or invalid.');
  }
  assert.ok((proxy.proxyUrl || '') === String(process.env.FINO_PROXY_URL || '').trim() && (proxy.proxyToken || '') === String(process.env.FINO_PROXY_TOKEN || '').trim(), 'Generated mobile configuration is stale. Run npm.cmd run mobile:config.');
  const activity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/tandy03/fino/MainActivity.java'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.ok(manifest.includes('android:allowBackup="false"') && manifest.includes('android:fullBackupContent="@xml/backup_rules"') && manifest.includes('android:dataExtractionRules="@xml/data_extraction_rules"'), 'Android financial backup policy is missing.');
  for (const file of ['backup_rules.xml', 'data_extraction_rules.xml']) assert.ok(fs.existsSync(path.join(root, 'android/app/src/main/res/xml', file)), 'Android backup exclusion rules are missing.');
  for (const plugin of ['GoogleDriveAuthPlugin', 'AppLockPlugin', 'FinoStoragePlugin', 'PortfolioTransferPlugin', 'PortfolioSharePlugin']) {
    assert.ok(activity.includes('registerPlugin(' + plugin + '.class)'), 'A required Android plugin is not registered.');
  }
  assert.ok(manifest.includes('android:name=".PortfolioShareFileProvider"') && manifest.includes('android:authorities="${applicationId}.portfolio-share"'), 'PNG sharing provider is missing.');
  const pngPaths = fs.readFileSync(path.join(root, 'android/app/src/main/res/xml/portfolio_share_paths.xml'), 'utf8');
  assert.ok(pngPaths.includes('path="portfolio-share/"') && !pngPaths.includes('path="."') && !pngPaths.includes('external-path'), 'PNG provider must expose only its private share directory.');
  console.log(`Mobile preflight passed: ${references} asset references, ${scripts.length + 1} JavaScript sources, native configuration and plugin registration.`);
  console.log(configured ? 'Generated proxy configuration matches the build environment. Secret values were not printed.' : 'Offline-only build: no market proxy configured.');
  console.log(`Android web bundle contains ${entries.length} verified compiled resources from ${graph.files.length} modules, including ${sharedEntries.length} shared implementations. Existing APK was not changed.`);
  if (process.argv.includes('--live-proxy')) {
    const { fetchWithTimeout } = require('../../shared/request');
    const response = await fetchWithTimeout(proxy.proxyUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: proxy.proxyToken, action: 'health' }),
    }, { timeoutMs: 20000 });
    const payload = await response.json();
    assert.ok(response.ok && payload?.ok === true && payload.data?.service === 'fino-market-proxy', 'Live proxy authentication or health check failed.');
    const proxyApi = require('../../shared/market-model').proxyCompatibility(payload.api, 'health');
    assert.ok(proxyApi.state === 'compatible' && proxyApi.release === require('../../apps-script/api-contract.json').release, 'Live deployment differs from the repository release. Run the proxy release procedure.');
    console.log('Live market proxy authenticated health check passed. No deployment was changed.');
  }
}
main().catch(error => {
  // Never print a provider URL, request body, stack or arbitrary upstream message.
  const message = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Mobile preflight failed; check local files or network availability.';
  console.error(message);
  process.exitCode = 1;
});
