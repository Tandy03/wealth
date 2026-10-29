const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '../..');
function authored(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'vendor' || entry.name.endsWith('.generated.js')) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? authored(file) : file.endsWith('.js') ? [file] : [];
  });
}
test('lint checks every authored frontend/shared module and automatically covers future files', async () => {
  assert.equal(require('../../package.json').scripts.lint, 'eslint frontend/js shared');
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(['frontend/js', 'shared']);
  const expected = ['frontend/js', 'shared'].flatMap(dir => authored(path.join(root, dir))).sort();
  assert.deepEqual(results.map(result => result.filePath).sort(), expected);
  assert.equal(results.reduce((sum, result) => sum + result.errorCount, 0), 0);
  assert.equal(await eslint.isPathIgnored(path.join(root, 'frontend/js/mobile-config.generated.js')), true);
  assert.equal(await eslint.isPathIgnored(path.join(root, 'frontend/vendor/chart.umd.js')), true);
  for (const filePath of ['frontend/js/future-module.js', 'shared/future-module.js']) {
    const [result] = await eslint.lintText('unreviewedFutureBinding();', { filePath });
    assert.ok(result.messages.some(message => message.ruleId === 'no-undef'), filePath);
  }
});
