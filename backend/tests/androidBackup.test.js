const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const xml = name => new JSDOM(fs.readFileSync('android/app/src/main/' + name, 'utf8'), { contentType: 'text/xml' });
test('Android excludes financial journals, credentials, WebView and lock state from cloud backup and device transfer', () => {
  const manifest = xml('AndroidManifest.xml'), legacy = xml('res/xml/backup_rules.xml'), modern = xml('res/xml/data_extraction_rules.xml');
  try {
    const app = manifest.window.document.querySelector('application');
    assert.equal(app.getAttribute('android:allowBackup'), 'false');
    assert.equal(app.getAttribute('android:fullBackupContent'), '@xml/backup_rules');
    assert.equal(app.getAttribute('android:dataExtractionRules'), '@xml/data_extraction_rules');
    for (const rules of [legacy.window.document.querySelector('full-backup-content'), ...modern.window.document.querySelectorAll('cloud-backup,device-transfer')]) {
      assert.ok(rules); assert.equal(rules.querySelector('include'), null);
      for (const domain of ['root','file','database','sharedpref','external','device_root','device_file','device_database','device_sharedpref'])
        assert.ok(rules.querySelector(`exclude[domain="${domain}"][path="."]`), domain);
    }
    assert.equal(modern.window.document.querySelectorAll('cloud-backup,device-transfer').length, 2);
  } finally { manifest.window.close(); legacy.window.close(); modern.window.close(); }
});
