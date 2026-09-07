const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, debtFromCsv, debtHistoryFromCsv } = require("../services/macroeconomics/client");

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
