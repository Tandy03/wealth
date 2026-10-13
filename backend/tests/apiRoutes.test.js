const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createApp } = require("../app");
const { createRepository } = require("../data/repository");

const emptyData = () => ({ assets: [], transactions: [], payments: [], sales: [], calendarNotes: [], priceHistory: [], wallet: { expenses: [], months: {}, loans: [] }, instruments: [] });
const stock = (id = "stock-1") => ({ id, name: "Test stock", type: "stock", currency: "USD", quantity: 10, purchasePrice: 100, currentPrice: 120, purchaseDate: "2026-01-01" });
const fixture = () => ({ ...emptyData(), assets: [stock()], transactions: [{ id: "buy-1", assetId: "stock-1", type: "BUY", date: "2026-01-01", quantity: 10, amount: 1000, currency: "USD" }] });

test("HTTP API retains portfolio, payment, calendar, wallet and sync behavior", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fino-api-"));
  const driveCalls = [];
  const drive = {
    isEnabled: () => false,
    getStatus: () => ({ enabled: false, connected: false }),
    downloadData: async () => null,
    uploadData: async (data) => driveCalls.push(["upload", data]),
    createManualBackup: async (data) => driveCalls.push(["backup", data]),
    reconnect: async () => driveCalls.push(["reconnect"]),
  };
  const repository = createRepository({ dataFile: path.join(dir, "data.json"), drive });
  const server = createApp({ repository }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function request(method, url, body) {
    const response = await fetch(base + url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const reset = (data = fixture()) => repository.writeLocalData(data);

  await t.test("serves the frontend and all existing collection endpoints", async () => {
    await reset();
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
    assert.equal((await fetch(base + "/js/api.js")).status, 200);
    const data = await request("GET", "/api/data");
    assert.equal(data.status, 200);
    for (const collection of ["assets", "sales", "transactions", "payments", "calendar-notes"]) {
      const result = await request("GET", "/api/" + collection);
      assert.equal(result.status, 200);
      assert.ok(Array.isArray(result.data));
    }
  });
  await t.test("creates fractional holdings and preserves validation responses", async () => {
    await reset(emptyData());
    const invalid = await request("POST", "/api/assets", {});
    assert.deepEqual(invalid, { status: 400, data: { error: "Asset name is required.", code: "VALIDATION_FAILURE", category: "validation" } });
    const created = await request("POST", "/api/assets", { ...stock(), id: undefined, quantity: 1.5 });
    assert.equal(created.status, 201);
    assert.equal(created.data.quantity, 1.5);
    const data = await repository.readData();
    assert.equal(data.transactions[0].amount, 150);
    assert.equal(data.assets.length, 1);
  });
  await t.test("updates a holding and buys more using the weighted average price", async () => {
    await reset();
    const updated = await request("PUT", "/api/assets/stock-1", { ...stock(), currentPrice: 130 });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.currentPrice, 130);
    const bought = await request("POST", "/api/assets/stock-1/buy", { quantity: 2, purchasePrice: 160, purchaseDate: "2026-02-01" });
    assert.equal(bought.status, 201);
    assert.equal(bought.data.asset.quantity, 12);
    assert.equal(bought.data.asset.purchasePrice, 110);
    assert.equal(bought.data.transaction.amount, 320);
  });
  await t.test("sells fractional quantities and rejects overselling", async () => {
    await reset();
    const sold = await request("POST", "/api/sales", { assetId: "stock-1", quantity: 2.5, sellPrice: 120, sellDate: "2026-02-01" });
    assert.equal(sold.status, 201);
    assert.equal(sold.data.sale.costBasis, 250);
    assert.equal(sold.data.sale.profit, 50);
    assert.equal(sold.data.remainingQuantity, 7.5);
    assert.equal((await request("POST", "/api/sales", { assetId: "stock-1", quantity: 8, sellPrice: 120, sellDate: "2026-02-01" })).status, 400);
  });
  await t.test("distributes grouped sales across matching holdings", async () => {
    const data = fixture();
    data.assets.push({ ...stock("stock-2"), quantity: 5, purchasePrice: 110, purchaseDate: "2026-02-01" });
    data.transactions.push({ id: "buy-2", assetId: "stock-2", type: "BUY", date: "2026-02-01", quantity: 5, amount: 550 });
    await reset(data);
    const result = await request("POST", "/api/sales", { assetIds: ["stock-1", "stock-2"], quantity: 12, sellPrice: 120, sellDate: "2026-03-01" });
    assert.equal(result.status, 201);
    assert.deepEqual(result.data.sales.map((sale) => sale.quantity), [10, 2]);
    assert.equal(result.data.remainingQuantity, 3);
  });
  await t.test("merges holdings and reassigns historical records", async () => {
    const data = fixture();
    data.assets.push({ ...stock("stock-2"), quantity: 5, purchasePrice: 160 });
    data.transactions.push({ id: "buy-2", assetId: "stock-2", type: "BUY", date: "2026-01-01", quantity: 5, amount: 800 });
    await reset(data);
    const result = await request("POST", "/api/assets/merge", { assetIds: ["stock-1", "stock-2"] });
    assert.equal(result.status, 200);
    const merged = await repository.readData();
    assert.equal(merged.assets.length, 1);
    assert.equal(merged.assets[0].quantity, 15);
    assert.equal(merged.assets[0].purchasePrice, 120);
    assert.ok(merged.transactions.every((tx) => tx.assetId === merged.assets[0].id));
  });
  await t.test("received maturity closes the holding and is recorded only once", async () => {
    const data = fixture();
    data.assets[0].type = "ovdp";
    data.payments.push({ id: "maturity", assetId: "stock-1", assetName: "Test stock", type: "MATURITY", date: "2026-06-01", status: "planned", amount: 10000, currency: "UAH" });
    await reset(data);
    for (let i = 0; i < 2; i++) assert.equal((await request("PATCH", "/api/payments/maturity/received")).status, 200);
    const saved = await repository.readData();
    assert.ok(saved.assets[0].closedAt);
    assert.equal(saved.transactions.filter((tx) => tx.paymentId === "maturity").length, 1);
    assert.equal((await request("POST", "/api/sales", { assetId: "stock-1", quantity: 1, sellPrice: 1000, sellDate: "2026-06-02" })).status, 400);
  });
  await t.test("creates payments and notes with the existing response shapes", async () => {
    await reset();
    const payment = await request("POST", "/api/payments", { assetId: "stock-1", date: "2026-02-01", type: "DIVIDEND", status: "planned", amount: 5, amountPerUnit: 0.5, currency: "USD" });
    assert.equal(payment.status, 201);
    assert.ok(payment.data.id);
    const note = await request("POST", "/api/calendar-notes", { assetId: "stock-1", date: "2026-02-01", text: "  Reminder  " });
    assert.equal(note.status, 201);
    assert.equal(note.data.text, "Reminder");
    assert.equal((await request("POST", "/api/calendar-notes", { assetId: "missing", date: "2026-02-01", text: "Reminder" })).status, 404);
  });
  await t.test("saves wallet data and normalizes expenses", async () => {
    await reset();
    assert.equal((await request("PUT", "/api/wallet", {})).status, 400);
    const result = await request("PUT", "/api/wallet", { expenses: [{ date: "2026-02-01", category: " Food ", amount: "25", note: " lunch " }], months: {}, loans: [] });
    assert.equal(result.status, 200);
    assert.equal(result.data.expenses[0].category, "Food");
    assert.equal(result.data.expenses[0].amount, 25);
    assert.equal(result.data.expenses[0].currency, "UAH");
  });
  await t.test("serializes concurrent mutations without losing writes", async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request("POST", "/api/calendar-notes", { assetId: "stock-1", date: "2026-02-01", text: "Note " + i })));
    assert.ok(results.every((result) => result.status === 201));
    const saved = await repository.readData();
    assert.equal(saved.calendarNotes.length, 12);
    assert.equal(saved.sync.revision, 12);
  });
  await t.test("keeps sync aliases, backup behavior, and error payloads", async () => {
    await reset();
    for (const url of ["/api/sync/status", "/api/google-drive/status"]) {
      const status = await request("GET", url);
      assert.equal(status.status, 200); assert.equal(status.data.state, "local-saved"); assert.equal(status.data.savedLocally, true); assert.equal(status.data.savedRemotely, false);
    }
    assert.equal((await request("POST", "/api/sync/google-drive", { action: "backup" })).status, 200);
    assert.equal(driveCalls.at(-1)[0], "backup");
    const missing = await request("POST", "/api/google-drive/sync", { action: "download" });
    assert.equal(missing.status, 404); assert.equal(missing.data.error, "fino-data.json was not found on Google Drive.");
    const originalUpload = drive.uploadData;
    drive.uploadData = async () => { throw new Error("mock offline"); };
    const failed = await request("POST", "/api/sync/google-drive", { action: "upload" });
    assert.equal(failed.status, 502);
    assert.equal(failed.data.code, "REMOTE_UNAVAILABLE");
    assert.equal(failed.data.status.state, "local-saved"); assert.equal(failed.data.status.savedLocally, true);
    drive.uploadData = originalUpload;
  });
  await t.test("transaction validation supports fractions and ignores injected identity fields", async () => {
    await reset();
    const result = await request("POST", "/api/transactions", { id: "injected", createdAt: "injected", assetName: "injected", assetId: "stock-1", type: "BUY", date: "2026-03-01", quantity: 0.25, amount: 25, currency: "USD", unexpected: true });
    assert.equal(result.status, 201);
    assert.notEqual(result.data.id, "injected");
    assert.notEqual(result.data.createdAt, "injected");
    assert.equal(result.data.assetName, "Test stock");
    assert.equal(result.data.quantity, 0.25);
    assert.equal(result.data.unexpected, undefined);
    for (const patch of [{ assetId: "missing" }, { quantity: "NaN" }, { amount: -1 }, { date: "2026-02-30" }, { type: "UNKNOWN" }, { currency: "EUR" }]) {
      const invalid = await request("POST", "/api/transactions", { assetId: "stock-1", type: "BUY", date: "2026-03-01", quantity: 1, amount: 100, currency: "USD", ...patch });
      assert.equal(invalid.status, patch.assetId === "missing" ? 404 : 400);
    }
    const data = fixture(); data.assets[0].type = "ovdp"; await reset(data);
    assert.equal((await request("POST", "/api/transactions", { assetId: "stock-1", type: "BUY", date: "2026-03-01", quantity: 0.5, amount: 50 })).status, 400);
  });
  await t.test("payment validation rejects invalid references, amounts, dates and status injection", async () => {
    await reset();
    const valid = { assetId: "stock-1", type: "DIVIDEND", date: "2026-03-01", amount: 5, currency: "USD" };
    const result = await request("POST", "/api/payments", { ...valid, id: "injected", createdAt: "injected", received: true, receivedAt: "injected", assetName: "injected", unexpected: true });
    assert.equal(result.status, 201);
    assert.notEqual(result.data.id, "injected");
    assert.notEqual(result.data.createdAt, "injected");
    assert.equal(result.data.assetName, "Test stock");
    assert.equal(result.data.status, "planned");
    assert.equal(result.data.received, undefined);
    assert.equal(result.data.unexpected, undefined);
    for (const patch of [{ assetId: "missing" }, { amount: "NaN" }, { amount: -1 }, { amountPerUnit: -1 }, { date: "2026-02-30" }, { date: undefined }, { type: "UNKNOWN" }, { status: "received" }, { currency: "EUR" }]) {
      assert.equal((await request("POST", "/api/payments", { ...valid, ...patch })).status, patch.assetId === "missing" ? 404 : 400);
    }
  });
  await t.test("legacy paid payments cannot generate duplicate receipt transactions", async () => {
    const data = fixture(); data.payments.push({ id: "legacy", assetId: "stock-1", type: "DIVIDEND", amount: 5, status: "paid" }); await reset(data);
    assert.equal((await request("PATCH", "/api/payments/legacy/received")).status, 200);
    assert.equal((await repository.readData()).transactions.filter(tx => tx.paymentId === "legacy").length, 0);
  });
  await t.test("deleting a holding removes its related records", async () => {
    const data = fixture();
    for (const key of ["sales", "payments", "calendarNotes", "priceHistory"]) data[key].push({ id: key + "-1", assetId: "stock-1" });
    await reset(data);
    const deleted = await request("DELETE", "/api/assets/stock-1");
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.success, true);
    const saved = await repository.readData();
    for (const key of ["assets", "transactions", "sales", "payments", "calendarNotes", "priceHistory"]) assert.equal(saved[key].length, 0);
    assert.equal((await request("DELETE", "/api/assets/stock-1")).status, 404);
  });
});
