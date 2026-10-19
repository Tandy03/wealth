// Build-time resource mapping only. This module never invokes Capacitor or Gradle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in mobile resources.');
    return entry.isDirectory() ? files(target) : [target];
  });
}
function assetEntries(root) {
  return ['frontend', 'shared'].flatMap(directory => {
    const base = path.join(root, directory);
    return files(base).map(source => ({ source, relative: (directory === 'shared' ? 'shared/' : '') + path.relative(base, source).split(path.sep).join('/') }));
  });
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verifyAssets(root, destination) {
  const entries = assetEntries(root);
  for (const entry of entries) {
    const target = path.join(destination, entry.relative);
    if (!fs.existsSync(target) || hash(target) !== hash(entry.source)) throw new Error('Mobile resources are missing or outdated. Run npm run mobile:prepare.');
  }
  const actual = files(destination).map(file => path.relative(destination, file).split(path.sep).join('/'));
  if (actual.length !== entries.length) throw new Error('Mobile resources contain stale files. Run npm run mobile:prepare.');
  return entries;
}
function prepareAssets(root) {
  root = path.resolve(root);
  const destination = path.join(root, '.tmp', 'mobile-web');
  // The only replaceable directory is this dedicated, generated workspace child.
  // Resolve existing ancestors too: never follow a junction to another directory.
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  if (fs.realpathSync(path.join(root, '.tmp')) !== path.join(fs.realpathSync(root), '.tmp')) throw new Error('Unsafe mobile staging directory.');
  if (fs.existsSync(destination) && fs.realpathSync(destination) !== path.join(fs.realpathSync(root), '.tmp', 'mobile-web')) throw new Error('Unsafe mobile staging directory.');
  const entries = assetEntries(root);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    const target = path.join(destination, entry.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.source, target);
  }
  verifyAssets(root, destination);
  return { destination, entries };
}
module.exports = { assetEntries, prepareAssets, verifyAssets };
