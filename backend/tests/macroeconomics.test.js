const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, debtFromCsv, debtHistoryFromCsv, createClient } = require("../services/macroeconomics/client");
const macroModel = require('../../shared/market-model');
const csv = 'STRUCTURE[;],INDICATOR,PRICE_TYPE,REGION,BREAKDOWN_CATEGORY,BREAKDOWN,SECTOR_ECONOMY,FREQ,TIME_PERIOD,OBS_VALUE\n' + [
  'dataflow,GDP_CUR_PRC,CURR_PRICES,UA00000000000000000,_T,_T,S_1,A,2023,6537825',
  'dataflow,GDP_CUR_PRC,CURR_PRICES,UA00000000000000000,_T,_T,S_1,A,2024,7658659',
  'dataflow,GDP_CUR_PRC,IDX_VOL_PY,UA00000000000000000,_T,_T,S_1,A,2023,105.5',
  'dataflow,GDP_CUR_PRC,IDX_VOL_PY,UA00000000000000000,_T,_T,S_1,A,2024,103.2',
].join('\n');
const policyRows = [{ id_api: 'KEY_PolicyRate', dt: '20260101', value: 15 }, { id_api: 'KEY_PolicyRate', dt: '20260102', value: 15.5 }];

test("parses quoted SDMX CSV fields", () => {
  assert.deepEqual(parseCsv('A,B,C\r\n1,"GDP, current prices",3\r\n'), [["A", "B", "C"], ["1", "GDP, current prices", "3"]]);
});

test("extracts a debt time series from the latest Ministry of Finance table", () => {
  const csv = ',31.12.2024,31.01.2025\nPublic debt,"6,500.25","6,600.50"\nDomestic debt,1800,1850\nExternal debt,"4,700.25","4,750.50"';
  assert.deepEqual(debtHistoryFromCsv(csv), [
    { date: "2024-12-31", total: 6500.25, domestic: 1800, external: 4700.25, debtToGdp: null },
    { date: "2025-01-31", total: 6600.5, domestic: 1850, external: 4750.5, debtToGdp: null },
  ]);
});

test("extracts debt categories from an official-style CSV table", () => {
  const point = debtFromCsv('Category,USD,EUR,UAH,%\nPublic debt,24,20,"1,000.50",90\nDomestic debt,10,8,400,36\nExternal debt,14,12,600.5,54', "2026-07-31");
  assert.deepEqual(point, { date: "2026-07-31", total: 1000.5, domestic: 400, external: 600.5, debtToGdp: null });
});

test('GDP requests only the official country totals instead of the oversized national-accounts dataset', async () => {
  const client = createClient({ fetchImpl: async url => {
    const params = new URL(url).searchParams;
    for (const [key, value] of Object.entries({ 'c[INDICATOR]': 'GDP_CUR_PRC', 'c[PRICE_TYPE]': 'CURR_PRICES,IDX_VOL_PY', 'c[REGION]': 'UA00000000000000000', 'c[BREAKDOWN_CATEGORY]': '_T', 'c[BREAKDOWN]': '_T', 'c[SECTOR_ECONOMY]': 'S_1', 'c[FREQ]': 'A' })) assert.equal(params.get(key), value);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv' } });
  } });
  const result = await client.getGdp();
  assert.equal(result.nominal.length, 2); assert.equal(result.realIndex.at(-1).value, 103.2);
  assert.throws(() => macroModel.gdp('<html>Provider error</html>'), /No valid GDP/);
  assert.throws(() => macroModel.policyRate([]), /No valid NBU/);
});

test('the 45-second policy budget survives a response later than the previous 10-second limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const client = createClient({ fetchImpl: async () => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 15000));
    return new Response(JSON.stringify(policyRows), { headers: { 'Content-Type': 'application/json' } });
  } });
  const first = client.getPolicyRate(), second = client.getPolicyRate();
  t.mock.timers.tick(15000);
  assert.deepEqual(await first, [{ date: '2026-01-01', value: 15 }, { date: '2026-01-02', value: 15.5 }]);
  await second; assert.equal(requests, 1);
});

test('a stalled policy provider remains bounded and an empty response is never cached as success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stuck = createClient({ fetchImpl: () => new Promise(() => {}) });
  const rejected = assert.rejects(stuck.getPolicyRate(), { code: 'EXTERNAL_API_TIMEOUT' });
  t.mock.timers.tick(45001); await rejected;
  let calls = 0;
  const client = createClient({ fetchImpl: async () => new Response(JSON.stringify(++calls === 1 ? [] : policyRows), { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(client.getPolicyRate(), /No valid NBU/);
  assert.equal((await client.getPolicyRate()).length, 2); assert.equal(calls, 2);
});

test('partial macro failures expire quickly and concurrent refreshes share one request set', async () => {
  let clock = Date.parse('2026-10-13T12:00:00Z'), gdpCalls = 0, available = false;
  const client = createClient({ now: () => clock, fetchImpl: async url => {
    if (new URL(url).hostname === 'stat.gov.ua') {
      gdpCalls++; if (!available) throw new Error('Bearer macro-private-sentinel https://provider.test/private');
      return new Response(csv);
    }
    const payload = new URL(url).hostname === 'data.gov.ua' ? { result: { resources: [] } } : [];
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
  } });
  const [first, concurrent] = await Promise.all([client.getMacroeconomics(), client.getMacroeconomics()]);
  assert.ok(first.errors.gdp); assert.equal(concurrent, first); assert.equal(gdpCalls, 1);
  assert.ok(!JSON.stringify(first).includes('macro-private-sentinel'));
  available = true; clock += 31000;
  const recovered = await client.getMacroeconomics();
  assert.equal(recovered.errors.gdp, undefined); assert.equal(recovered.gdp.nominal.length, 2); assert.equal(gdpCalls, 2);
});
