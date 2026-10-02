const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRepository } = require('../data/repository');
const { createService } = require('../domain/portfolioService');

test('failed initialization upload retains the committed remote snapshot', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-init-upload-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const local = { assets: [{ id: 'local', name: 'Old local' }] };
  const remote = { assets: [{ id: 'remote', name: 'Downloaded' }], custom: { preserved: true } };
  await fs.writeFile(dataFile, JSON.stringify(local));
  let attempts = 0;
  const repository = createRepository({ dataFile, drive: {
    isEnabled: () => true,
    initialize: async () => ({ source: 'google-drive', data: structuredClone(remote) }),
    uploadData: async () => { attempts++; throw new Error('offline'); },
  } });
  const first = await repository.readData();
  assert.equal(attempts, 1);
  assert.deepEqual(first.assets, remote.assets);
  assert.deepEqual(first.custom, remote.custom);
  assert.equal(first.sync.revision, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(dataFile, 'utf8')).assets, remote.assets);
  assert.deepEqual((await repository.readData()).assets, remote.assets);
});

test('invalid writes and imports preserve the last valid repository snapshot', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-validation-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const repository = createRepository({ dataFile, drive: { isEnabled: () => false } });
  await repository.readData();
  const before = await fs.readFile(dataFile, 'utf8');
  for (const write of [repository.saveData, repository.writeLocalData]) {
    await assert.rejects(write({ assets: [], payments: {} }), /payments/);
    await assert.rejects(write({ assets: [], wallet: { expenses: 'invalid' } }), /expenses/);
    await assert.rejects(write({ assets: [{ currentPrice: Infinity }] }), /finite/);
    assert.equal(await fs.readFile(dataFile, 'utf8'), before);
  }
});

test('first-run reads and mutations initialize JSON once without losing an asset', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fino-first-run-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  const repository = createRepository({ dataFile, drive: { isEnabled: () => false } });
  const service = createService(repository, {});
  const creation = service.createAsset({
    name: 'First holding', type: 'stock', quantity: 1, purchasePrice: 100,
    currentPrice: 100, purchaseDate: '2026-01-01', currency: 'USD',
  });
  const results = await Promise.allSettled([
    ...Array.from({ length: 25 }, () => repository.readData()), creation,
  ]);
  assert.ok(results.every((result) => result.status === 'fulfilled'),
    JSON.stringify(results.filter((result) => result.status === 'rejected').map((result) => result.reason.message)));
  const saved = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  assert.equal(saved.assets.length, 1);
  assert.equal(saved.transactions.length, 1);
  assert.equal(saved.assets[0].name, 'First holding');
});
