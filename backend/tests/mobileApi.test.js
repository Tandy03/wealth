const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, fixture, clone } = require('./helpers/nativeHarness');

test('native proxy keeps legacy deployments usable and rejects incompatible envelopes before exposing market data', async () => {
  const h = harness({ proxy: true });
  const data = { values: [{ datetime: '2026-10-01', open: 100, high: 101, low: 99, close: 100 }] };
  let api;
  h.hooks.externalFetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).apiVersion, 1);
    return new Response(JSON.stringify({ ok: true, ...(api ? {api} : {}), data }));
  };
  assert.equal((await h.api.getMarketTimeSeries({symbol:'AAPL'})).values.length,1);
  assert.equal((await h.api.getGoogleDriveStatus()).proxy.state,'legacy');
  api = require('../../apps-script/api-contract.json');
  await h.api.getMarketTimeSeries({symbol:'AAPL'});assert.equal((await h.api.getGoogleDriveStatus()).proxy.release,api.release);
  api={...api,apiVersion:2,minClientVersion:2};
  await assert.rejects(h.api.getMarketTimeSeries({symbol:'AAPL'}),e=>e.code==='PROXY_API_INCOMPATIBLE'&&e.category==='remote_unavailable');
  assert.equal((await h.api.getGoogleDriveStatus()).proxy.state,'incompatible');
});

test('native API normalizes validation and storage failures without exposing causes or changing local data', async () => {
  const h = harness(); await h.api.getData(); const before = h.local();
  await assert.rejects(h.api.createAsset({}), error => error.code === 'VALIDATION_FAILURE' && error.status === 400 &&
    error.category === 'validation' && Boolean(error.requestId) && !Object.hasOwn(error, 'cause'));
  assert.deepEqual(h.local(), before);
  h.hooks.failPreference = key => key.startsWith('fino-journal-v1:');
  await assert.rejects(h.api.createCalendarNote({ text: 'safe note', assetId: 'bond', date: '2026-03-01' }), error =>
    error.code === 'STORAGE_FAILURE' && error.status === 503 && error.category === 'storage_failure' && Boolean(error.requestId));
  assert.deepEqual(h.local(), before);
});

test('native rebalance persists web targets through local recovery, Drive upload and subsequent desktop changes', async () => {
  const local = fixture();
  const plan = { targets: { ovdp: 30, 'planned-etf': 70 }, plannedAssets: [{ id: 'planned-etf', label: 'ETF' }], excluded: [] };
  local.rebalance = clone(plan);
  const h = harness({ local }); await h.api.getData();
  const changed = clone(plan); changed.targets.ovdp = 40; changed.targets['planned-etf'] = 60;
  const saved = await h.api.saveRebalance({ plan: changed, expected: plan });
  assert.equal(saved.persistence.savedLocally, true); assert.equal(saved.persistence.savedRemotely, false);
  assert.deepEqual(h.local().rebalance, changed);
  await assert.rejects(h.api.saveRebalance({ plan, expected: plan }), { status: 409 });
  await h.drain(); assert.deepEqual(h.remote().rebalance, changed);
  assert.deepEqual(h.local().assets, local.assets);
  const restart = harness({ local: h.local(), remote: h.remote(), metadata: false });
  restart.storage.set('fino-journal-v1:test%40example.com', h.storage.get('fino-journal-v1:test%40example.com'));
  assert.deepEqual(clone((await restart.api.getData({ sync: false })).rebalance), changed);
  const desktop = h.remote(); desktop.sync.revision++; desktop.rebalance.excluded = ['ovdp'];
  h.changeRemote(desktop); await h.api.syncGoogleDrive('download');
  assert.deepEqual(clone((await h.api.getData({ sync: false })).rebalance), desktop.rebalance);
  const before = h.local();
  await assert.rejects(h.api.saveRebalance({ plan: { ...changed, targets: { ovdp: Infinity } }, expected: desktop.rebalance }), { code: 'VALIDATION_FAILURE' });
  assert.deepEqual(h.local(), before);
});

test('native partial macro failures do not expose provider diagnostics or discard available rates', async () => {
  const h = harness();
  h.hooks.externalFetch = async url => {
    if (url.hostname === 'stat.gov.ua') throw new Error('Bearer native-macro-private-sentinel C:\\local\\data.json');
    return new Response(JSON.stringify(url.pathname.endsWith('/exchange') ? [{ cc: 'USD', rate: 41, exchangedate: '13.10.2026', txt: 'US Dollar' }] : []));
  };
  const data = await h.api.getMacroeconomics();
  assert.equal(data.exchangeRates[0].rate, 41); assert.ok(data.errors.gdp);
  assert.ok(!JSON.stringify(data).includes('native-macro-private-sentinel'));
});

test('native macroeconomics selects the compact official GDP series and populates both chart datasets', async () => {
  const h = harness();
  h.hooks.externalFetch = async url => {
    if (url.hostname === 'stat.gov.ua') {
      assert.equal(url.searchParams.get('c[INDICATOR]'), 'GDP_CUR_PRC');
      assert.equal(url.searchParams.get('c[PRICE_TYPE]'), 'CURR_PRICES,IDX_VOL_PY');
      const csv = 'INDICATOR,PRICE_TYPE,REGION,BREAKDOWN_CATEGORY,BREAKDOWN,SECTOR_ECONOMY,FREQ,TIME_PERIOD,OBS_VALUE\nGDP_CUR_PRC,CURR_PRICES,UA00000000000000000,_T,_T,S_1,A,2024,7658659\nGDP_CUR_PRC,IDX_VOL_PY,UA00000000000000000,_T,_T,S_1,A,2024,103.2';
      return new Response(csv);
    }
    const rows = url.pathname.endsWith('/exchange') ? [{ cc: 'USD', rate: 41, exchangedate: '13.10.2026', txt: 'US Dollar' }] : [];
    return new Response(JSON.stringify(rows));
  };
  const data = await h.api.getMacroeconomics();
  assert.equal(data.errors.gdp, undefined); assert.equal(data.gdp.nominal[0].value, 7658659); assert.equal(data.gdp.realIndex[0].value, 103.2);
});

test('native policy rates survive slow official responses and coalesce concurrent loads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(); let calls = 0;
  h.hooks.externalFetch = async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 15000));
    return new Response(JSON.stringify([{ id_api: 'KEY_PolicyRate', dt: '20260101', value: 15 }]));
  };
  const first = h.api.getNbuPolicyRate(), second = h.api.getNbuPolicyRate();
  t.mock.timers.tick(15000);
  assert.equal((await first).policyRate[0].value, 15); await second; assert.equal(calls, 1);
});

test('an empty legacy proxy response and failed NBU fallback never poison the native policy cache', async () => {
  const h = harness({ proxy: true }); let directCalls = 0, proxyCalls = 0;
  h.hooks.externalFetch = async url => {
    if (url.hostname === 'script.google.com') { proxyCalls++; return new Response(JSON.stringify({ ok: true, data: { policyRate: [] } })); }
    directCalls++;
    if (directCalls === 1) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify([{ id_api: 'KEY_PolicyRate', dt: '20260101', value: 15 }]));
  };
  await assert.rejects(h.api.getNbuPolicyRate(), /temporarily unavailable/);
  assert.equal((await h.api.getNbuPolicyRate()).policyRate[0].value, 15);
  assert.equal(directCalls, 2); assert.equal(proxyCalls, 2);
});

test('native pending purchases never rewrite completed financial history', async () => {
  const local = fixture();
  local.transactions.push({ id: 'pending', assetId: 'bond', type: 'BUY', status: 'pending', quantity: 5, amount: 10000, date: '2026-02-01' });
  const h = harness({ local });
  const data = await h.api.getData({ sync: false });
  assert.equal(data.transactions[0].quantity, 10); assert.equal(data.transactions[0].amount, 10000);
  assert.equal(data.assets[0].remainingQuantity, 10); assert.equal(data.assets[0].remainingCostBasis, 10000);
  assert.deepEqual(h.local().transactions, local.transactions);
});

test('normalizing a downloaded portfolio stays pending until the exact local version is uploaded', async () => {
  const h = harness(); await h.api.getData();
  const remote = h.remote(); delete remote.assets[0].remainingQuantity; delete remote.assets[0].remainingCostBasis;
  h.changeRemote(remote);
  await h.api.syncGoogleDrive('download');
  assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-pending');
  assert.ok(h.local().sync.revision > remote.sync.revision);
  assert.equal(h.remote().assets[0].remainingQuantity, undefined);
  await h.api.syncGoogleDrive();
  assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-confirmed');
  assert.deepEqual(h.remote(), h.local());
});

test('normalized local data is durably journaled and failure cannot expose an uncommitted cache', async () => {
  const local = fixture(); delete local.assets[0].remainingQuantity;
  const h = harness({ local }); h.hooks.failPreference = key => key.startsWith('fino-journal-v1:');
  await assert.rejects(h.api.getData({ sync: false }), { code: 'STORAGE_FAILURE' });
  assert.deepEqual(h.local(), local);
  h.hooks.failPreference = null;
  const data = await h.api.getData({ sync: false });
  assert.equal(data.assets[0].remainingQuantity, 10);
  assert.equal((await h.api.getGoogleDriveStatus()).savedRemotely, false);
  assert.deepEqual(h.local(), clone(data));
});

test('a remote change during download is rejected without replacing the local portfolio', async () => {
  const h = harness(); await h.api.getData(); const before = h.local();
  h.hooks.afterMedia = () => { h.hooks.afterMedia = null; const remote = h.remote(); remote.calendarNotes.push({ id: 'race', text: 'concurrent edit' }); h.changeRemote(remote); };
  await assert.rejects(h.api.syncGoogleDrive('download'), { code: 'SYNC_CONFLICT' });
  assert.deepEqual(h.local(), before); assert.equal(h.backups.length, 0);
});

test('native refuses shared main files and ambiguous duplicate portfolio files', async () => {
  const h = harness(); h.hooks.notOwned = true;
  await assert.rejects(h.api.syncGoogleDrive(), { code: 'AUTHORIZATION_REQUIRED' });
  assert.equal(h.uploads.length, 0);
  const duplicate = harness(); duplicate.hooks.portfolioFiles = [{ id: 'one' }, { id: 'two' }];
  await assert.rejects(duplicate.api.syncGoogleDrive(), { code: 'SYNC_CONFLICT' });
  assert.equal(duplicate.uploads.length, 0);
});

test('remote deletion on a clean phone requires an explicit replacement choice', async () => {
  const h = harness(); await h.api.getData(); const before = h.local(); h.changeRemote(null);
  await assert.rejects(h.api.syncGoogleDrive(), { code: 'SYNC_CONFLICT' });
  assert.equal(h.remote(), null); assert.equal(h.uploads.length, 0); assert.deepEqual(h.local(), before);
  await h.api.syncGoogleDrive('upload');
  assert.deepEqual(h.remote(), before); assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-confirmed');
});

test('successful upload HTTP status alone never confirms unsaved native data', async () => {
  const h = harness(); await h.api.getData(); h.hooks.dropUpload = true;
  await h.api.createCalendarNote({ assetId: 'bond', text: 'not yet uploaded', date: '2026-10-01' }); await h.drain();
  const status = await h.api.getGoogleDriveStatus();
  assert.equal(status.savedRemotely, false); assert.equal(status.state, 'conflict');
  assert.equal(h.local().calendarNotes.length, 1); assert.equal(h.remote().calendarNotes.length, 0);
});

test('registered FinoStorage handles native journal writes and invalid actions make no Drive requests', async () => {
  const h = harness({ confirmedStorage: true }); await h.api.getData({ sync: false });
  await assert.rejects(h.api.syncGoogleDrive('unknown'), { code: 'VALIDATION_FAILURE' });
  assert.equal(h.hooks.driveCalls || 0, 0);
  h.offline(true); await h.api.createCalendarNote({ assetId: 'bond', text: 'confirmed disk storage', date: '2026-10-01' }); await h.drain();
  assert.equal(h.local().calendarNotes.length, 1);
  assert.ok(h.storage.get('fino-journal-v1:test%40example.com'));
});

test('native journal failure rejects a financial edit without changing data or sync metadata', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  const before = h.local(), metadata = h.storage.get('fino-sync-v2:test%40example.com');
  h.hooks.failPreference = key => key.startsWith('fino-journal-v1:');
  await assert.rejects(h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-01' }), { code: 'STORAGE_FAILURE' });
  assert.deepEqual(h.local(), before); assert.equal(h.storage.get('fino-sync-v2:test%40example.com'), metadata);
  assert.deepEqual(clone(await h.api.getData({ sync: false })), before);
});
test('native committed journal recovers a failed compatibility cache write after restart', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  h.hooks.failPreference = key => key.startsWith('fino-data-v1:');
  const purchase = await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-01' });
  assert.equal(purchase.persistence.savedLocally, true); assert.equal(purchase.persistence.savedRemotely, false);
  await h.drain();
  const restarted = harness({ local: h.local(), remote: h.remote() });
  restarted.storage.set('fino-journal-v1:test%40example.com', h.storage.get('fino-journal-v1:test%40example.com'));
  const recovered = await restarted.api.getData({ sync: false });
  assert.equal(recovered.assets[0].quantity, 11); assert.equal(recovered.transactions.length, 2);
  assert.equal((await restarted.api.getGoogleDriveStatus()).state, 'sync-pending');
});
test('native manual backup keeps unsent financial changes pending', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-01' }); await h.drain();
  h.offline(false); const result = await h.api.syncGoogleDrive('backup');
  assert.equal(result.savedLocally, true); assert.equal(result.savedRemotely, false); assert.equal(result.backupSaved, true);
  assert.equal(result.status.state, 'sync-pending'); assert.equal(h.remote().assets[0].quantity, 10);
});

test('native sale then purchase uses the remaining cost and preserves earlier sale results', async () => {
  const local = fixture();
  Object.assign(local.assets[0], { name: 'Stock', type: 'stock', purchasePrice: 100, currentPrice: 200, purchaseDate: '2026-01-01' });
  local.transactions[0].amount = 1000;
  const h = harness({ local });
  await h.api.getData({ sync: false }); h.offline(true);
  await h.api.createSale({ assetId: 'bond', quantity: 5, sellPrice: 120, sellDate: '2026-02-01' });
  const firstSale = clone(h.local().sales[0]);
  const bought = await h.api.buyMoreAsset('bond', { quantity: 5, purchasePrice: 200, purchaseDate: '2026-03-01' });
  assert.equal(bought.purchasePrice, 150);
  assert.equal(bought.remainingQuantity, 10);
  assert.equal(bought.remainingCostBasis, 1500);
  await h.api.createSale({ assetId: 'bond', quantity: 2, sellPrice: 200, sellDate: '2026-04-01' });
  assert.equal(h.local().sales[1].costBasis, 300);
  assert.deepEqual(h.local().sales[0], firstSale);
  await h.drain();
});

test('native merge builds one dividend schedule and rejects incompatible ticker metadata', async () => {
  const h = harness(); await h.api.getData({ sync: false }); h.offline(true);
  const body = { name: 'REIT', type: 's1_reit', currency: 'UAH', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-01', dividendPerUnit: 10, firstDividendDate: '2026-11-10' };
  const a = await h.api.createAsset(body), b = await h.api.createAsset(body);
  await h.api.mergeAssets([a.id, b.id]);
  const dividends = h.local().payments.filter(p => p.assetId === a.id && p.date === '2026-11-10');
  assert.equal(dividends.length, 1);
  assert.equal(dividends[0].amount, 200);
  const c = await h.api.createAsset({ ...body, ticker: 'OTHER' });
  const before = h.local();
  await assert.rejects(h.api.mergeAssets([a.id, c.id]), /matching/);
  assert.deepEqual(h.local(), before);
  await h.drain();
});

test('native market sync permits concurrent purchases and applies prices to the latest snapshot', async () => {
  const local = fixture();
  Object.assign(local.assets[0], { isin: 'TEST', purchaseDate: '2026-01-01' });
  const h = harness({ local }); await h.api.getData({ sync: false }); h.offline(true);
  let release, fetched;
  const started = new Promise(resolve => { fetched = resolve; });
  const catalog = new Promise(resolve => { release = resolve; });
  h.offline(false);
  h.hooks.inzhurCatalog = () => { fetched(); return catalog; };
  const sync = h.api.syncApiAssets();
  await started;
  await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: 1200, purchaseDate: '2026-03-01' });
  release([{ type: 'bond', assetDetails: { isin: 'TEST', maturityDate: '2027-12-01', prices: { sellUAH: 1100 }, paymentSchedule: [{ date: '2027-05-31T21:00:00.000Z', amount: 5000 }, { date: '2027-11-30T22:00:00.000Z', amount: 100000 }] } }]);
  await sync;
  const saved = h.local();
  assert.equal(saved.assets[0].quantity, 11);
  assert.equal(saved.assets[0].currentPrice, 1100);
  assert.equal(saved.transactions.filter(tx => tx.type === 'BUY').length, 2);
  assert.equal(saved.payments.find(p => p.type === 'COUPON').amount, 550);
  assert.equal(saved.payments.find(p => p.type === 'COUPON').date, '2027-06-01');
  assert.equal(saved.payments.find(p => p.type === 'MATURITY').amount, 11000);
  assert.equal(saved.payments.find(p => p.type === 'MATURITY').date, '2027-12-01');
  await h.drain();
});
test('a stalled background upload never blocks local reads or another committed edit', async () => {
  const h = harness(); await h.api.getData();
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let inspectedOlderConfirmation = false;
  h.hooks.beforeDriveRequest = async () => {
    began(); await gate;
    if (h.uploads.length === 1 && !inspectedOlderConfirmation) {
      inspectedOlderConfirmation = true;
      assert.equal((await h.api.getGoogleDriveStatus()).pendingUpload, true, 'the first upload cannot confirm the newer edit');
    }
  };
  await h.api.createCalendarNote({ assetId: 'bond', date: '2026-10-17', text: 'first' });
  const syncing = h.drain(); await started;
  let timer;
  try {
    await Promise.race([(async () => {
      const local = await h.api.getData({ sync: false }); assert.equal(local.calendarNotes.length, 1);
      await h.api.createCalendarNote({ assetId: 'bond', date: '2026-10-17', text: 'second' });
      assert.equal((await h.api.getCalendarNotes()).length, 2);
      assert.equal((await h.api.getGoogleDriveStatus()).pendingUpload, true);
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Drive blocked local operations')), 500); })]);
  } finally { clearTimeout(timer); release(); await syncing; }
  assert.equal(inspectedOlderConfirmation, true);
  assert.equal(h.uploads[0].calendarNotes.length, 1);
  assert.equal(h.remote().calendarNotes.length, 2);
  assert.equal((await h.api.getGoogleDriveStatus()).state, 'sync-confirmed');
});

test('rapid local edits coalesce into one upload and cached reads do not request Google tokens', async () => {
  const h = harness(); await h.api.getData({ sync: false });
  const tokens = h.hooks.authCalls;
  await Promise.all(Array.from({ length: 20 }, (_, i) => h.api.createCalendarNote({ assetId: 'bond', date: '2026-10-17', text: 'edit ' + i })));
  await h.api.getData({ sync: false }); await h.api.getTransactions(); await h.api.getPayments();
  assert.equal(h.hooks.authCalls, tokens);
  await h.drain();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.remote().calendarNotes.length, 20);
});

test('a download cannot replace edits committed while its network requests were running', async () => {
  const h = harness(); await h.api.getData();
  const remote = h.remote(); remote.calendarNotes.push({ id: 'remote', text: 'desktop' }); h.changeRemote(remote);
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  h.hooks.beforeDriveRequest = async parsed => {
    if (parsed.searchParams.get('alt') === 'media') { began(); await gate; }
  };
  const download = h.api.syncGoogleDrive('download');
  await started;
  try { await h.api.createCalendarNote({ assetId: 'bond', date: '2026-10-17', text: 'phone' }); }
  finally { release(); }
  await assert.rejects(download, { code: 'SYNC_CONFLICT' }); await h.drain();
  assert.equal(h.local().calendarNotes[0].text, 'phone');
  assert.equal(h.remote().calendarNotes[0].text, 'desktop');
  assert.equal(h.uploads.length, 0);
});

test('compact journals migrate legacy entries, survive rollover and reject altered deltas', async () => {
  const local = fixture();
  local.priceHistory = Array.from({ length: 100 }, (_, index) => ({ assetId: 'bond', date: '2026-01-01', price: 1000 + index }));
  const metadata = { baseline: JSON.stringify(local), pendingUpload: true };
  const entry = { snapshot: local, metadata, checksum: await require('../../frontend/js/sync-model').checksum({ snapshot: local, metadata }) };
  const h = harness({ local, metadata: false });
  h.storage.set('fino-journal-v1:test%40example.com', JSON.stringify({ version: 1, entries: [entry] }));
  await h.api.getData({ sync: false }); h.offline(true);
  await Promise.all(Array.from({ length: 55 }, (_, index) => h.api.createCalendarNote({ assetId: 'bond', date: '2026-10-17', text: 'edit ' + index })));
  await h.drain();
  const serialized = h.storage.get('fino-journal-v1:test%40example.com');
  const document = JSON.parse(serialized);
  assert.equal(document.version, 2); assert.equal(document.entries.length, 50);
  assert.ok(serialized.length < JSON.stringify(h.local()).length * 10, 'unchanged price history is stored once, not fifty times');
  const restart = harness({ local: fixture(), metadata: false });
  restart.storage.set('fino-journal-v1:test%40example.com', serialized);
  const recovered = await restart.api.getData({ sync: false });
  assert.equal(recovered.calendarNotes.length, 55); assert.equal(recovered.priceHistory.length, 100);
  await h.api.deleteAsset('bond'); await h.drain();
  const afterDelete = harness({ metadata: false });
  afterDelete.storage.set('fino-journal-v1:test%40example.com', h.storage.get('fino-journal-v1:test%40example.com'));
  const deleted = await afterDelete.api.getData({ sync: false });
  assert.equal(deleted.assets.length, 0); assert.equal(deleted.calendarNotes.length, 0); assert.equal(deleted.priceHistory.length, 0);
  document.entries.at(-1).delta.snapshot.set.assets = [{ id: 'tampered' }];
  const corrupt = harness({ metadata: false }); corrupt.storage.set('fino-journal-v1:test%40example.com', JSON.stringify(document));
  await assert.rejects(corrupt.api.getData({ sync: false }), /journal is corrupted/);
});

test('legacy journals with large full-document baselines remain recoverable', async () => {
  const local = fixture();
  local.priceHistory = Array.from({ length: 2500 }, (_, index) => ({ assetId: 'bond', date: '2026-01-01', price: 1000 + index }));
  const metadata = { baseline: JSON.stringify(local), pendingUpload: true };
  assert.ok(metadata.baseline.length > 100000);
  const entry = { snapshot: local, metadata, checksum: await require('../../frontend/js/sync-model').checksum({ snapshot: local, metadata }) };
  const h = harness({ metadata: false });
  h.storage.set('fino-journal-v1:test%40example.com', JSON.stringify({ version: 1, entries: [entry] }));
  assert.equal((await h.api.getData({ sync: false })).priceHistory.length, 2500);
});

test('reconnect cancels a deferred automatic upload without reopening Google authorization', async () => {
  const h = harness(); await h.api.getData({ sync: false });
  await h.api.createCalendarNote({ assetId: 'bond', date: '2026-10-17', text: 'kept on device' });
  await h.api.syncGoogleDrive('reconnect'); await h.drain();
  assert.equal(h.hooks.authCalls || 0, 0); assert.equal(h.uploads.length, 0);
  assert.equal(h.local().calendarNotes[0].text, 'kept on device');
  assert.equal(h.storage.get('fino-active-account'), undefined);
  assert.equal((await h.api.getGoogleDriveStatus()).state, 'auth-required');
});

test('cached startup reads do not wait for unavailable Drive requests', async () => {
  const h = harness();
  h.hooks.hangDrive = true; h.hooks.hangAuth = true;
  const data = await h.api.getData({ sync: false });
  assert.equal(data.assets[0].id, 'bond');
  assert.equal(h.hooks.driveCalls || 0, 0);
  assert.equal(h.hooks.authCalls || 0, 0);
  assert.equal(h.uploads.length, 0);
});

test('mobile deletion removes all related records and preserves other holdings', async () => {
  const local = fixture();
  local.assets.push({ id: 'other', name: 'Other', type: 'stock', quantity: 1 });
  for (const collection of ['transactions', 'payments', 'sales', 'calendarNotes', 'priceHistory']) {
    local[collection].push({ id: collection + '-bond', assetId: 'bond' }, { id: collection + '-other', assetId: 'other' });
  }
  const h = harness({ local });
  await h.api.getData({ sync: false });
  h.offline(true);
  await h.api.deleteAsset('bond');
  const saved = h.local();
  assert.deepEqual(saved.assets.map(item => item.id), ['other']);
  for (const collection of ['transactions', 'payments', 'sales', 'calendarNotes', 'priceHistory']) {
    assert.deepEqual(saved[collection].map(item => item.assetId), ['other']);
  }
  await assert.rejects(h.api.deleteAsset('missing'), /Asset not found/);
  assert.deepEqual(h.local(), saved);
  await h.drain();
});

test('mobile purchases calculate using the same canonical fields that were validated', async () => {
  for (const purchase of [
    { quantity: 1, purchasePrice: 1200, price: 'invalid', purchaseDate: '2026-03-01', date: '2026-02-01' },
    { quantity: 1, purchasePrice: 1200, price: 500, purchaseDate: '2026-03-01', date: '2026-02-01' },
    { quantity: 1, price: 1200, date: '2026-03-01' },
  ]) {
    const h = harness();
    await h.api.getData({ sync: false });
    h.offline(true);
    const asset = await h.api.buyMoreAsset('bond', purchase);
    assert.equal(asset.quantity, 11);
    assert.equal(asset.purchasePrice, 11200 / 11);
    const transaction = h.local().transactions.at(-1);
    assert.equal(transaction.purchasePrice, 1200);
    assert.equal(transaction.amount, 1200);
    assert.equal(transaction.date, '2026-03-01');
    await h.drain();
  }
});

test('native operations share strict validation and rejected requests preserve the local snapshot', async () => {
  const h = harness();
  await h.api.getData({ sync: false });
  h.offline(true);
  const before = h.local();
  for (const purchase of [
    { quantity: true, purchasePrice: 1000, purchaseDate: '2026-03-01' },
    { quantity: 1, purchasePrice: 'oops', purchaseDate: '2026-03-01' },
    { quantity: 0.5, purchasePrice: 1000, purchaseDate: '2026-03-01' },
    { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-02-30' },
    { quantity: 1, purchasePrice: 1000, purchaseDate: '2026-03-01', currency: 'USD' },
  ]) {
    await assert.rejects(h.api.buyMoreAsset('bond', purchase));
    assert.deepEqual(h.local(), before);
  }
  await assert.rejects(h.api.createSale({ assetId: 'bond', quantity: 1, sellPrice: 1000, sellDate: '2026-02-30' }));
  await assert.rejects(h.api.saveWallet({ expenses: [{ date: '2026-03-01', category: 'Food', amount: true }], months: {} }));
  await assert.rejects(h.api.syncGoogleDrive('unknown'));
  assert.deepEqual(h.local(), before);
  const bought = await h.api.buyMoreAsset('bond', { quantity: 1, purchasePrice: '1200', purchaseDate: '2026-03-01' });
  assert.equal(bought.quantity, 11);
  assert.equal(bought.purchasePrice, 11200 / 11);
  await h.drain();
});

test('equal-revision divergent edits produce a conflict without replacing either copy', async () => {
  const h = harness(); await h.api.getData();
  h.offline(true);
  await h.api.createCalendarNote({ assetId: 'bond', date: '2026-03-01', text: 'phone' }); await h.drain();
  const remote = h.remote(); remote.sync.revision = 8; remote.calendarNotes.push({ id: 'desktop-note', text: 'desktop' }); h.changeRemote(remote); h.offline(false);
  const localBefore = h.local();
  await assert.rejects(h.api.syncGoogleDrive(), { code: 'SYNC_CONFLICT' });
  assert.deepEqual(h.local(), localBefore);
  assert.deepEqual(h.remote(), remote);
  const status = await h.api.getGoogleDriveStatus(); assert.equal(status.conflict, true); assert.equal(status.pendingUpload, true);
});
test('a newer remote revision does not replace unsent local changes during getData', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  await h.api.saveWallet({ expenses: [], months: { '2026-03': { budget: 50 } }, loans: [] }); await h.drain();
  const remote = h.remote(); remote.sync.revision = 20; remote.wallet.months = { '2026-04': {} }; h.changeRemote(remote); h.offline(false);
  const result = await h.api.getData(); assert.equal(result.wallet.months['2026-03'].budget, 50); assert.equal(h.uploads.length, 0);
  assert.equal((await h.api.getGoogleDriveStatus()).conflict, true);
});
test('network failures remain pending across restart and never report Synced', async () => {
  const h = harness(); await h.api.getData(); h.offline(true);
  await h.api.createCalendarNote({ text: 'offline', assetId: 'bond', date: '2026-03-01' }); await h.drain();
  const status = await h.api.getGoogleDriveStatus(); assert.equal(status.connected, false); assert.equal(status.pendingUpload, true); assert.equal(status.errorCode, 'REMOTE_UNAVAILABLE'); assert.notEqual(status.status, 'Synced');
  assert.equal(JSON.parse(h.storage.get('fino-sync-v2:test%40example.com')).pendingUpload, true);
  const restarted = harness({ local: h.local(), remote: h.remote(), metadata: false });
  restarted.storage.set('fino-sync-v2:test%40example.com', h.storage.get('fino-sync-v2:test%40example.com'));
  await restarted.api.syncGoogleDrive(); assert.equal(restarted.remote().calendarNotes[0].text, 'offline'); assert.equal((await restarted.api.getGoogleDriveStatus()).pendingUpload, false);
});
test('offline authorization still allows reading and saving the last local account', async () => {
  const h = harness(); h.authOffline(true);
  const data = await h.api.getData(); assert.equal(data.assets[0].id, 'bond');
  await h.api.createCalendarNote({ text: 'offline account', assetId: 'bond', date: '2026-03-01' }); await h.drain();
  assert.equal(h.local().calendarNotes[0].text, 'offline account'); assert.notEqual((await h.api.getGoogleDriveStatus()).status, 'Synced');
});
test('manual backup creates a separate file and does not update the primary portfolio', async () => {
  const h = harness(); await h.api.getData(); const before = h.remote();
  await h.api.syncGoogleDrive('backup'); assert.equal(h.backups.length, 1); assert.deepEqual(h.backups[0], h.local()); assert.deepEqual(h.remote(), before); assert.equal(h.uploads.length, 0);
});
test('explicit download backs up local changes before replacing them', async () => {
  const h = harness(); await h.api.getData(); h.offline(true); await h.api.createCalendarNote({ text: 'local recovery', assetId: 'bond', date: '2026-03-01' }); await h.drain(); h.offline(false);
  const before = h.local(); const remote = h.remote(); remote.sync.revision = 8; remote.calendarNotes = [{ id: 'other', text: 'remote' }]; h.changeRemote(remote);
  await h.api.syncGoogleDrive('download'); assert.deepEqual(h.backups.at(-1), before); assert.equal(h.local().calendarNotes[0].text, 'remote'); assert.equal((await h.api.getGoogleDriveStatus()).pendingUpload, false);
});
test('a failed backup prevents destructive download', async () => {
  const h = harness(); await h.api.getData(); const before = h.local(); h.offline(true);
  await assert.rejects(h.api.syncGoogleDrive('download'), { code: 'REMOTE_UNAVAILABLE', category: 'remote_unavailable', status: 502 }); assert.deepEqual(h.local(), before);
});
test('explicit upload backs up the remote version first', async () => {
  const h = harness(); await h.api.getData(); h.offline(true); await h.api.createCalendarNote({ text: 'local', assetId: 'bond', date: '2026-03-01' }); await h.drain(); h.offline(false);
  const remote = h.remote(); remote.calendarNotes = [{ id: 'other', text: 'remote recovery' }]; remote.sync.revision = 9; h.changeRemote(remote);
  await h.api.syncGoogleDrive('upload'); assert.deepEqual(h.backups.at(-1), remote); assert.equal(h.remote().calendarNotes[0].text, 'local');
});
test('conditional upload detects a remote edit made after the initial read', async () => {
  const h = harness(); await h.api.getData();
  h.hooks.beforeUpload = () => { const remote = h.remote(); remote.calendarNotes.push({ id: 'race', text: 'concurrent' }); h.changeRemote(remote); };
  await h.api.createCalendarNote({ text: 'phone', assetId: 'bond', date: '2026-03-01' }); await h.drain();
  assert.equal((await h.api.getGoogleDriveStatus()).conflict, true); assert.equal(h.remote().calendarNotes[0].text, 'concurrent'); assert.equal(h.local().calendarNotes[0].text, 'phone');
});
test('concurrent mutations are persisted and uploaded in order', async () => {
  const h = harness(); await h.api.getData();
  await Promise.all(Array.from({ length: 10 }, (_, i) => h.api.createCalendarNote({ text: 'note ' + i, assetId: 'bond', date: '2026-03-01' }))); await h.drain();
  assert.equal(h.local().calendarNotes.length, 10); assert.equal(h.remote().calendarNotes.length, 10); assert.equal((await h.api.getGoogleDriveStatus()).pendingUpload, false);
});
test('clean devices adopt remote changes without relying on revision ordering', async () => {
  const h = harness(); await h.api.getData(); const remote = h.remote(); remote.sync.revision = 7; remote.calendarNotes.push({ id: 'other', text: 'desktop edit' }); h.changeRemote(remote);
  assert.equal((await h.api.getData()).calendarNotes[0].text, 'desktop edit'); assert.equal(h.uploads.length, 0);
});
test('closed or redeemed bonds cannot be sold, and maturity closes the holding', async () => {
  for (const marker of ['closedAt', 'received', 'paid']) {
    const local = fixture();
    if (marker === 'closedAt') local.assets[0].closedAt = '2026-02-01';
    else local.payments.push({ id: 'maturity', assetId: 'bond', type: 'MATURITY', status: marker, amount: 10000 });
    const h = harness({ local });
    await assert.rejects(h.api.createSale({ assetId: 'bond', quantity: 1, sellPrice: 1000, sellDate: '2026-03-01' }), /Not enough/);
    assert.equal(h.local().sales.length, 0);
  }
  const local = fixture(); local.payments.push({ id: 'maturity', assetId: 'bond', type: 'MATURITY', status: 'planned', amount: 10000 });
  const h = harness({ local }); await h.api.markPaymentReceived('maturity'); await h.drain();
  assert.ok(h.local().assets[0].closedAt); await h.api.markPaymentReceived('maturity'); await h.drain(); assert.equal(h.local().transactions.filter(tx => tx.paymentId === 'maturity').length, 1);
});
test('failed mutations do not leave partial changes in local storage', async () => {
  const h = harness(); const before = h.local();
  await assert.rejects(h.api.createSale({ assetId: 'bond', quantity: 1.5, sellPrice: 1000, sellDate: '2026-03-01' }), /whole number/);
  assert.deepEqual(h.local(), before);
});

test('legacy installations with unknown sync history never overwrite differing remote data', async () => {
  const local = fixture(); const remote = fixture(); remote.calendarNotes.push({ id: 'other', text: 'desktop history' });
  const h = harness({ local, remote, metadata: false }); await h.api.getData();
  assert.deepEqual(h.remote(), remote); assert.equal(h.uploads.length, 0); assert.equal((await h.api.getGoogleDriveStatus()).conflict, true);
});
test('corrupted local JSON is reported instead of replaced with an empty portfolio', async () => {
  const h = harness(); h.storage.set('fino-data-v1:test%40example.com', '{invalid');
  await assert.rejects(h.api.getData(), /corrupted/); assert.equal(h.storage.get('fino-data-v1:test%40example.com'), '{invalid'); assert.equal(h.uploads.length, 0);
});

test('first upload retries safely after an interrupted multipart creation', async () => {
  const h = harness({ remote: null }); h.hooks.failUpload = true;
  await assert.rejects(h.api.syncGoogleDrive('upload'), { code: 'REMOTE_UNAVAILABLE', category: 'remote_unavailable', status: 502 });
  h.hooks.failUpload = false;
  await h.api.syncGoogleDrive('upload');
  assert.equal(h.remote().assets[0].id, 'bond');
});
test('invalid remote structure cannot mark a corrupt local snapshot usable on a later request', async () => {
  const h = harness(); h.storage.set('fino-data-v1:test%40example.com', '{"assets":"broken"}');
  await assert.rejects(h.api.getData());
  await assert.rejects(h.api.getData());
});

test('explicit upload can recover a legacy empty Drive file after backing it up', async () => {
  const h = harness({ remote: {} });
  await h.api.syncGoogleDrive('upload');
  assert.deepEqual(h.backups[0], {}); assert.equal(h.remote().assets[0].id, 'bond');
});
test('an account switch during an upload cannot send one account portfolio to another account', async () => {
  const h = harness(); await h.api.getData(); let calls = 0;
  h.hooks.authEmail = () => ++calls === 1 ? 'test@example.com' : 'other@example.com';
  await assert.rejects(h.api.syncGoogleDrive('upload'), /account changed/i);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.storage.get('fino-data-v1:other%40example.com'), undefined);
});

test('an account switch after offline fallback aborts the same operation', async () => {
  const h = harness(); let calls = 0;
  h.hooks.authFailure = () => ++calls === 1;
  h.hooks.authEmail = () => 'other@example.com';
  await assert.rejects(h.api.syncGoogleDrive('upload'), { code: 'AUTHORIZATION_REQUIRED' });
  await assert.rejects(h.api.syncGoogleDrive('upload'), /account changed/i);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.storage.get('fino-data-v1:other%40example.com'), undefined);
});
test('malformed wallet collections are rejected without replacing local data', async () => {
  const h = harness(); const broken = fixture(); broken.wallet.expenses = {};
  const raw = JSON.stringify(broken); h.storage.set('fino-data-v1:test%40example.com', raw);
  await assert.rejects(h.api.getData()); await assert.rejects(h.api.getData());
  assert.equal(h.storage.get('fino-data-v1:test%40example.com'), raw);
});

test('collection reads cannot restore stale cached data over concurrent local mutations', async () => {
  for (const method of ['getSales', 'getTransactions', 'getPayments', 'getCalendarNotes']) {
    const h = harness(); h.offline(true);
    h.hooks.beforePreferenceGet = async (key) => {
      if (key === 'fino-data-v1:test%40example.com') await new Promise(setImmediate);
    };
    await Promise.all([
      h.api[method](),
      h.api.createCalendarNote({ text: 'first', assetId: 'bond', date: '2026-03-01' }),
    ]);
    await h.api.createCalendarNote({ text: 'second', assetId: 'bond', date: '2026-03-01' });
    await h.drain();
    assert.deepEqual(h.local().calendarNotes.map(note => note.text), ['first', 'second'], method);
  }
});
