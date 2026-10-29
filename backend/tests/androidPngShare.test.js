const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const directory = 'android/app/src/main/java/com/tandy03/fino/';
test('PNG provider exposes only a private cache subtree with read grants and independent Capacitor callbacks', () => {
  const manifest = new JSDOM(fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8'), { contentType: 'text/xml' });
  const paths = new JSDOM(fs.readFileSync('android/app/src/main/res/xml/portfolio_share_paths.xml', 'utf8'), { contentType: 'text/xml' });
  try {
    const provider = [...manifest.window.document.querySelectorAll('provider')].find(node => node.getAttribute('android:name') === '.PortfolioShareFileProvider');
    assert.ok(provider); assert.equal(provider.getAttribute('android:authorities'), '${applicationId}.portfolio-share');
    assert.equal(provider.getAttribute('android:exported'), 'false'); assert.equal(provider.getAttribute('android:grantUriPermissions'), 'true');
    assert.equal(provider.querySelector('meta-data').getAttribute('android:resource'), '@xml/portfolio_share_paths');
    assert.equal(paths.window.document.querySelector('paths').children.length, 1);
    assert.equal(paths.window.document.querySelector('cache-path').getAttribute('path'), 'portfolio-share/');
    assert.deepEqual([...manifest.window.document.querySelectorAll('uses-permission')].map(node => node.getAttribute('android:name')).sort(), ['android.permission.INTERNET', 'android.permission.USE_BIOMETRIC']);
    assert.equal(manifest.window.document.querySelector('queries intent data').getAttribute('android:mimeType'), 'image/png');
  } finally { manifest.window.close(); paths.window.close(); }
  const plugin = fs.readFileSync(directory + 'PortfolioSharePlugin.java', 'utf8');
  assert.match(fs.readFileSync(directory + 'MainActivity.java', 'utf8'), /registerPlugin\(PortfolioSharePlugin.class\)/);
  for (const callback of ['saveSelected', 'shareFinished']) assert.match(plugin, new RegExp('@ActivityCallback private void ' + callback));
  for (const token of ['ACTION_CREATE_DOCUMENT', 'ACTION_SEND', 'FLAG_GRANT_READ_URI_PERMISSION', 'ClipData.newUri', 'newSingleThreadExecutor', 'call.getData().remove("base64")', 'deliveryConfirmed", false', 'PngShareFiles.write(bytes', 'worker.shutdown()']) assert.ok(plugin.includes(token), token);
  assert.doesNotMatch(plugin, /FLAG_GRANT_WRITE_URI_PERMISSION|Uri.fromFile|Bitmap|android.util.Log|System.out|https?:\/\//);
  const savedState = plugin.slice(plugin.indexOf('@Override protected Bundle saveInstanceState()'), plugin.indexOf('@Override protected void handleOnDestroy()'));
  assert.match(savedState, /state.putBoolean\("pngInterrupted", true\)/);
  assert.doesNotMatch(savedState, /putString|putByteArray|putSerializable|super.saveInstanceState/);
  assert.equal(JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8')).loggingBehavior, 'none');
});
test('pure Java PNG validation and bounded cache pass without Gradle or Android packaging', t => {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const homes = [process.env.JAVA_HOME, process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : null].filter(Boolean);
  const home = homes.find(directory => fs.existsSync(path.join(directory, 'bin', 'javac' + suffix)));
  const javac = home ? path.join(home, 'bin', 'javac' + suffix) : 'javac';
  const java = home ? path.join(home, 'bin', 'java' + suffix) : 'java';
  const probe = spawnSync(javac, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (probe.error?.code === 'ENOENT') { t.skip('JDK not installed; run this check with a JDK before Android packaging.'); return; }
  assert.equal(probe.status, 0, 'Cannot execute the installed JDK.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fino-png-test-'));
  try {
    const compiled = spawnSync(javac, ['-encoding', 'UTF-8', '-d', temp, directory + 'PngShareFiles.java', 'backend/tests/java/PngShareFilesTest.java'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const result = spawnSync(java, ['-cp', temp, 'com.tandy03.fino.PngShareFilesTest', path.join(temp, 'cache')], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /synthetic checks passed/);
    t.diagnostic(result.stdout.trim());
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
