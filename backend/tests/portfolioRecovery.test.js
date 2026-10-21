const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { createRepository } = require('../data/repository');
const { createService } = require('../domain/portfolioTransferService');
const transfer = require('../../shared/portfolio-transfer');
const model = require('../../shared/state-model');
const rules = require('../../shared/portfolio-rules');
const sync = require('../../shared/sync-model');
const { digest } = require('../data/journal');
const { harness } = require('./helpers/nativeHarness');
const disabled = { isEnabled: () => false };
async function directory(t) {
  const prefix = path.join(os.tmpdir(), 'fino-recovery-drill-');
  const dir = await fs.mkdtemp(prefix);
  assert.ok(path.resolve(dir).startsWith(path.resolve(prefix)));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function portfolio(t) {
  const dir = await directory(t), dataFile = path.join(dir, 'source', 'data.json');
  const repository = createRepository({ dataFile, drive: disabled });
  const assets = require('../domain/assetService').createService(repository);
  const purchases = require('../domain/purchaseService').createService(repository);
  const sales = require('../domain/saleService').createService(repository);
  const asset = await assets.createAsset({ operationId: 'recovery-create', name: 'Synthetic recovery stock', type: 'stock', quantity: 10,
    purchasePrice: 100, currentPrice: 210, purchaseDate: '2026-01-01', currency: 'UAH' });
  await sales.sellAsset({ operationId: 'recovery-sale', assetId: asset.id, quantity: 5, sellPrice: 150, sellDate: '2026-02-01', currency: 'UAH' });
  await purchases.buyMoreAsset(asset.id, { operationId: 'recovery-buy', quantity: 5, purchasePrice: 200, purchaseDate: '2026-03-01', currency: 'UAH' });
  await assets.createAsset({ operationId: 'recovery-usd', name: 'Synthetic USD stock', type: 'stock', quantity: 2, purchasePrice: 25, currentPrice: 30, purchaseDate: '2026-01-02', currency: 'USD' });
  await repository.runMutation(async () => {
    const data = await repository.readData();
    data.payments.push({ id: 'receipt', assetId: asset.id, type: 'DIVIDEND', date: '2026-04-01', receivedDate: '2026-04-02', amount: 70, currency: 'UAH', status: 'received' });
    data.transactions.push({ id: 'receipt-tx', paymentId: 'receipt', assetId: asset.id, type: 'DIVIDEND', date: '2026-04-02', amount: 70, currency: 'UAH', status: 'completed' });
    data.calendarNotes.push({ id: 'note', title: 'Synthetic note', date: '2026-04-03' });
    data.wallet = { expenses: [{ id: 'expense', category: 'Health', date: '2026-04-01', amount: 75 }], months: { '2026-04': { plans: { Health: 500 }, customCategories: [], notes: [] } },
      loans: [{ id: 'loan', name: 'Synthetic loan', amount: 200, balance: 120, monthlyPayment: 20 }] };
    data.rebalance = { targets: { 'stock::synthetic recovery stock': 100 }, plannedAssets: [], excluded: [] };
    await repository.saveData(data);
  });
  const snapshot = await repository.readData(), file = await createService(repository).exportPortfolio();
  const backupFile = path.join(dir, 'manual-portfolio.json');
  await fs.writeFile(backupFile, JSON.stringify(file, null, 2), { mode: 0o600 });
  return { dir, dataFile, repository, snapshot, file, backupFile };
}
function totals(data) {
  const invested = {}, quantities = {};
  for (const asset of data.assets) {
    const holding = rules.holdingsAtDate(data, asset, '2026-10-21');
    invested[asset.currency] = (invested[asset.currency] || 0) + holding.remainingCost;
    quantities[asset.name] = holding.remainingQuantity;
  }
  return { invested, quantities, saleProfit: data.sales.reduce((sum, sale) => sum + sale.profit, 0),
    received: data.payments.filter(rules.received).reduce((sum, payment) => sum + payment.amount, 0),
    expenses: data.wallet.expenses.reduce((sum, item) => sum + item.amount, 0), loans: data.wallet.loans.reduce((sum, loan) => sum + loan.balance, 0),
    plans: data.wallet.months['2026-04'].plans, targets: data.rebalance.targets,
    operationIds: data.operations.map(entry => entry.operationId) };
}
async function assertRecovered(actual, expected) {
  assert.equal(await transfer.contentChecksum(actual), await transfer.contentChecksum(expected));
  assert.deepEqual(JSON.parse(JSON.stringify(totals(actual))), JSON.parse(JSON.stringify(totals(expected))));
  assert.deepEqual(totals(actual).invested, { UAH: 1500, USD: 50 });
  assert.deepEqual(totals(actual).quantities, { 'Synthetic recovery stock': 10, 'Synthetic USD stock': 2 });
  assert.equal(totals(actual).saleProfit, 250); assert.equal(totals(actual).received, 70);
}
async function restoreClean(h, suffix = 'clean') {
  const repository = createRepository({ dataFile: path.join(h.dir, suffix, 'data.json'), drive: disabled });
  const service = createService(repository), backup = JSON.parse(await fs.readFile(h.backupFile, 'utf8'));
  const preview = await service.previewPortfolioImport(backup);
  const outcome = await service.restorePortfolio({ backup, expected: preview.expected });
  assert.equal(outcome.persistence.savedLocally, true); assert.equal(outcome.persistence.savedRemotely, false);
  return { repository, backup };
}
test('recovery drill exports a real traded portfolio and restores checksum, income, cost basis, wallet and receipts into clean storage', async t => {
  const h = await portfolio(t), { checksum, ...unsigned } = h.file;
  assert.equal(checksum, createHash('sha256').update(sync.signature(unsigned)).digest('hex'));
  assert.equal(h.file.document.sync, undefined);
  const { repository } = await restoreClean(h);
  await assertRecovered(await repository.readData(), h.snapshot);
  const restarted = createRepository({ dataFile: path.join(h.dir, 'clean', 'data.json'), drive: disabled });
  await assertRecovered(await restarted.readData(), h.snapshot);
  const replay = await require('../domain/purchaseService').createService(restarted).buyMoreAsset(h.snapshot.assets[0].id,
    { operationId: 'recovery-buy', quantity: 5, purchasePrice: 200, purchaseDate: '2026-03-01', currency: 'UAH' });
  assert.ok(replay);
  await assertRecovered(await restarted.readData(), h.snapshot);
});
for (const loss of ['truncated-json', 'missing-json', 'torn-journal-tail', 'uncommitted-replacement']) {
  test(`recovery drill preserves committed financial totals after ${loss}`, async t => {
    const h = await portfolio(t);
    if (loss === 'missing-json') await fs.unlink(h.dataFile);
    else await fs.writeFile(h.dataFile, '{partial');
    if (loss === 'torn-journal-tail') await fs.appendFile(h.dataFile + '.journal.ndjson', '{"kind":');
    if (loss === 'uncommitted-replacement') {
      const uncommitted = structuredClone(h.snapshot); uncommitted.wallet.expenses.push({ id: 'not-committed', category: 'Health', date: '2026-04-02', amount: 999 });
      await fs.appendFile(h.dataFile + '.journal.ndjson', JSON.stringify({ kind: 'prepare', id: 'never-committed', checksum: digest(uncommitted), snapshot: uncommitted }) + '\n');
      await fs.writeFile(h.dataFile, JSON.stringify(uncommitted));
    }
    const recovered = createRepository({ dataFile: h.dataFile, drive: disabled });
    await assertRecovered(await recovered.readData(), h.snapshot);
    await assertRecovered(await (await restoreClean(h)).repository.readData(), h.snapshot);
  });
}
test('unrecoverable journal damage fails closed; a separately saved export restores into a new directory', async t => {
  const h = await portfolio(t);
  await fs.writeFile(h.dataFile, '{partial');
  await fs.writeFile(h.dataFile + '.journal.ndjson', '{corrupt-middle}\n{"kind":"commit","id":"x"}\n');
  await assert.rejects(createRepository({ dataFile: h.dataFile, drive: disabled }).readData(), { code: 'STORAGE_FAILURE' });
  assert.equal(await fs.readFile(h.dataFile, 'utf8'), '{partial');
  await assertRecovered(await (await restoreClean(h)).repository.readData(), h.snapshot);
});
test('damaged, oversized, incompatible and financially invalid exports cannot partially change a destination', async t => {
  const h = await portfolio(t), target = path.join(h.dir, 'invalid-target.json');
  const repository = createRepository({ dataFile: target, drive: disabled }); await repository.readData();
  const before = await fs.readFile(target, 'utf8'), service = createService(repository);
  const damaged = structuredClone(h.file); damaged.document.assets[0].quantity++;
  const invalid = structuredClone(h.file); invalid.document.assets[0].purchaseDate = '2026-02-31';
  const { checksum, ...unsigned } = invalid; invalid.checksum = await sync.checksum(unsigned);
  for (const backup of [JSON.stringify(h.file).slice(0, -5), damaged, { ...h.file, version: 999 }, invalid, 'x'.repeat(transfer.MAX_BYTES + 1)]) {
    await assert.rejects(service.previewPortfolioImport(backup), { code: 'VALIDATION_FAILURE' });
    await assert.rejects(service.restorePortfolio({ backup, expected: 'a'.repeat(64) }), { code: 'VALIDATION_FAILURE' });
    assert.equal(await fs.readFile(target, 'utf8'), before);
  }
  await assert.rejects(createService(h.repository).previewPortfolioImport(h.file), { code: 'RESTORE_NOT_EMPTY' });
  await assertRecovered(await h.repository.readData(), h.snapshot);
});
test('concurrent restores serialize once and reject a changed destination without duplicate facts', async t => {
  const h = await portfolio(t), repository = createRepository({ dataFile: path.join(h.dir, 'race.json'), drive: disabled });
  const service = createService(repository), preview = await service.previewPortfolioImport(h.file), request = { backup: h.file, expected: preview.expected };
  await assert.rejects(service.restorePortfolio({ ...request, expected: 'f'.repeat(64) }), { code: 'RESTORE_PREVIEW_STALE' });
  assert.equal((await repository.readData()).assets.length, 0);
  const results = await Promise.allSettled([service.restorePortfolio(request), service.restorePortfolio(request)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'RESTORE_NOT_EMPTY');
  await assertRecovered(await repository.readData(), h.snapshot);
});
test('native journal repairs missing/corrupted mirrors, then export restores offline on a pristine installation without Google', async t => {
  const h = await portfolio(t), source = harness({ local: h.snapshot, confirmedStorage: true });
  source.authOffline(true); source.offline(true);
  const original = await source.api.getData({ sync: false }), backup = await source.api.exportPortfolio();
  for (const mode of ['corrupt', 'missing', 'missing-metadata']) {
    const storage = new Map(source.storage);
    if (mode === 'corrupt') storage.set('fino-data-v1:test%40example.com', '{partial');
    else storage.delete('fino-data-v1:test%40example.com');
    if (mode === 'missing-metadata') storage.delete('fino-sync-v2:test%40example.com');
    const restarted = harness({ storage, confirmedStorage: true }); restarted.authOffline(true); restarted.offline(true);
    await assertRecovered(await restarted.api.getData({ sync: false }), original);
  }
  const destination = harness({ storage: new Map(), confirmedStorage: true }); destination.authOffline(true); destination.offline(true);
  const preview = await destination.api.previewPortfolioImport(backup);
  assert.equal(destination.storage.has('fino-active-account'), false, 'Preview must not create a local profile');
  const result = await destination.api.restorePortfolio({ backup, expected: preview.expected });
  assert.equal(result.persistence.savedLocally, true); assert.equal(result.persistence.savedRemotely, false);
  await assertRecovered(await destination.api.getData({ sync: false }), original);
  assert.equal(destination.hooks.authCalls || 0, 0); assert.equal(destination.hooks.driveCalls || 0, 0);
  const restarted = harness({ storage: destination.storage, confirmedStorage: true }); restarted.authOffline(true); restarted.offline(true);
  await assertRecovered(await restarted.api.getData({ sync: true }), original);
  assert.equal(restarted.hooks.authCalls || 0, 0); assert.equal(restarted.hooks.driveCalls || 0, 0);
  assert.equal(restarted.api.localAccountScope, 'local-only');
});
test('a corrupt native journal is preserved and a separate export recovers into clean native storage', async t => {
  const h = await portfolio(t), source = harness({ local: h.snapshot, confirmedStorage: true });
  source.authOffline(true); source.offline(true);
  const baseline = await source.api.getData({ sync: false }), backup = await source.api.exportPortfolio();
  const storage = new Map(source.storage);
  storage.set('fino-journal-v1:test%40example.com', '{torn-journal');
  const corrupted = harness({ storage, confirmedStorage: true }); corrupted.authOffline(true); corrupted.offline(true);
  await assert.rejects(corrupted.api.getData({ sync: false }), error => error.code === 'STORAGE_FAILURE');
  assert.equal(storage.get('fino-journal-v1:test%40example.com'), '{torn-journal');
  const fresh = harness({ storage: new Map(), confirmedStorage: true }); fresh.authOffline(true); fresh.offline(true);
  const preview = await fresh.api.previewPortfolioImport(backup);
  await assert.rejects(fresh.api.restorePortfolio({ backup, expected: 'f'.repeat(64) }), error => error.code === 'RESTORE_PREVIEW_STALE');
  assert.equal(fresh.storage.size, 0);
  await fresh.api.restorePortfolio({ backup, expected: preview.expected });
  await assertRecovered(await fresh.api.getData({ sync: false }), baseline);
});
test('native failed commit preserves the export and permits an explicit retry without a partial portfolio', async t => {
  const h = await portfolio(t), destination = harness({ storage: new Map(), confirmedStorage: true });
  destination.authOffline(true); destination.offline(true);
  const preview = await destination.api.previewPortfolioImport(h.file);
  destination.hooks.failPreference = key => key.startsWith('fino-journal-v1:');
  await assert.rejects(destination.api.restorePortfolio({ backup: h.file, expected: preview.expected }), error => error.code === 'STORAGE_FAILURE');
  assert.equal(destination.storage.has('fino-data-v1:local-only'), false);
  assert.equal(destination.storage.has('fino-active-account'), false);
  destination.hooks.failPreference = null;
  await destination.api.restorePortfolio({ backup: h.file, expected: preview.expected });
  await assertRecovered(await destination.api.getData({ sync: false }), h.snapshot);
});
test('HTTP export/preview/restore share validation and error shapes without Drive or external calls', async t => {
  const h = await portfolio(t), repository = createRepository({ dataFile: path.join(h.dir, 'http.json'), drive: disabled });
  const server = require('../app').createApp({ repository }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const previewResponse = await post('/api/portfolio/import/preview', { backup: h.file }); assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const restored = await post('/api/portfolio/import', { backup: h.file, expected: preview.expected }); assert.equal(restored.status, 200);
  assert.equal((await restored.json()).persistence.savedLocally, true);
  const exported = await fetch(base + '/api/portfolio/export'); assert.equal(exported.status, 200); assert.equal(exported.headers.get('cache-control'), 'no-store');
  await assertRecovered((await transfer.validateExport(await exported.json())).data, h.snapshot);
  const rejected = await post('/api/portfolio/import', { backup: h.file, expected: preview.expected });
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).category, 'conflict'); assert.ok(rejected.headers.get('x-request-id'));
  const invalid = await post('/api/portfolio/import/preview', { backup: { wrong: true } });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'VALIDATION_FAILURE');
});
