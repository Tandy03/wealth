const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequire } = require('node:module');

test('xcode generates project identifiers with the patched uuid dependency', () => {
  const project = require('xcode').project('fixture.pbxproj');
  project.hash = { project: { objects: {} } };
  const first = project.generateUuid();
  const second = project.generateUuid();
  assert.match(first, /^[A-F0-9]{24}$/);
  assert.match(second, /^[A-F0-9]{24}$/);
  assert.notEqual(first, second);
});

test('local-auth gaxios sends a multipart request with the patched uuid dependency', async t => {
  const localAuthRequire = createRequire(require.resolve('@google-cloud/local-auth'));
  const authRequire = createRequire(localAuthRequire.resolve('google-auth-library'));
  const { request } = authRequire('gaxios');
  let received;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString() };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await request({
    url: `http://127.0.0.1:${server.address().port}/upload`,
    method: 'POST',
    multipart: [{ headers: { 'Content-Type': 'application/json' }, content: JSON.stringify({ fixture: true }) }],
    timeout: 5000,
    retry: false,
  });
  assert.equal(response.data.ok, true);
  const boundary = received.contentType.match(/boundary=([^;]+)/)?.[1];
  assert.ok(boundary);
  assert.ok(received.body.includes('--' + boundary));
  assert.ok(received.body.includes('"fixture":true'));
});
