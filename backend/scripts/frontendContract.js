// Build/test-time checks only. The browser never fetches or evaluates this manifest.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const manifest = require('../../frontend-globals.json');
const identifierCache = new Map();

function identifiers(source) {
  return [...new Set(source.match(/[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*/gu) || [])].filter(name => {
    if (!identifierCache.has(name)) {
      try { new vm.Script(`"use strict"; let ${name};`); identifierCache.set(name, true); }
      catch (_) { identifierCache.set(name, false); }
    }
    return identifierCache.get(name);
  });
}
function scriptSources(html) {
  const activeHtml = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  return [...activeHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map(([, attributes, inline]) => {
    assert.equal(inline.trim(), '', 'Inline frontend scripts must be explicitly reviewed.');
    assert.ok(!/\b(?:async|defer|type)\b/i.test(attributes), 'Frontend scripts must preserve classic loading order.');
    const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    assert.ok(source && /^\/(?:js|shared|vendor)\/[\w./-]+\.js$/.test(source), 'Frontend scripts must be local packaged resources.');
    assert.ok(!source.split('/').includes('..'), 'Frontend script path escapes local resources.');
    return source;
  });
}
function sourcePath(source) {
  return path.join(root, source.startsWith('/shared/') ? '.' : 'frontend', source);
}
function validateBindings(source, { src, bindings = [] }) {
  if (src.startsWith('/vendor/') || src.endsWith('/mobile-config.generated.js')) return;
  const allowed = new Set(bindings);
  const blocked = identifiers(source).filter(name => !allowed.has(name));
  try { new vm.Script(`${source}\n;let {${blocked.join(',')}} = {};`, { filename: src }); }
  catch (error) { throw new Error(`Unreviewed global binding or invalid script: ${src}`, { cause: error }); }
}
function assertReviewedGlobals(script, before, after) {
  const allowed = new Set(script.globals);
  const unexpected = Object.keys(after).filter(name => {
    const previous = before[name], current = after[name];
    return (!previous || !Object.is(previous.value, current.value) || previous.get !== current.get || previous.set !== current.set) && !allowed.has(name);
  });
  assert.deepEqual(unexpected, [], `Unreviewed browser globals in ${script.src}`);
}
function validateFrontend(html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8')) {
  const sources = scriptSources(html);
  assert.deepEqual(sources, manifest.scripts.map(script => script.src), 'Frontend script order differs from the reviewed contract.');
  const all = [];
  for (const { src, bindings = [] } of manifest.scripts) {
    const source = fs.readFileSync(sourcePath(src), 'utf8');
    all.push(source);
    // Declaring every other identifier in the same classic scope exposes any
    // unlisted top-level const/let/var/function/class (including destructuring).
    // Vendor/generated sources are owned by their external/config contracts.
    validateBindings(source, { src, bindings });
  }
  new vm.Script(all.join('\n;\n'), { filename: 'frontend/index.html scripts' });
  return sources;
}
module.exports = { manifest, identifiers, scriptSources, sourcePath, validateBindings, assertReviewedGlobals, validateFrontend };
