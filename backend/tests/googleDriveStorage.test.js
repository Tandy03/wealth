const test = require("node:test");
const assert = require("node:assert/strict");
const { validateData, hasConflict, retryOperation } = require("../services/googleDrive/storage");
const { AUTHORIZATION_OPTIONS, DRIVE_SCOPE } = require("../services/googleDrive/auth");

test("Google authorization requests offline access and only drive.file", () => {
  assert.equal(AUTHORIZATION_OPTIONS.access_type, "offline");
  assert.deepEqual(AUTHORIZATION_OPTIONS.scope, [DRIVE_SCOPE]);
});

test("rejects corrupted Google Drive portfolio JSON", () => {
  assert.throws(() => validateData({ assets: "not-an-array", transactions: [], payments: [] }), /invalid assets collection/);
  assert.throws(() => validateData(null), /JSON object/);
});

test("detects checksum and newer-revision conflicts", () => {
  assert.equal(hasConflict({ expectedChecksum: "old", actualChecksum: "new" }), true);
  assert.equal(hasConflict({ expectedChecksum: "same", actualChecksum: "same" }), false);
  assert.equal(hasConflict({ knownRevision: 15, remoteRevision: 16 }), true);
  assert.equal(hasConflict({ knownRevision: 16, remoteRevision: 16 }), false);
});

test("retries temporary offline failures and eventually succeeds", async () => {
  let attempts = 0;
  const result = await retryOperation(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("network offline");
    return "synced";
  }, 3, async () => {});
  assert.equal(result, "synced");
  assert.equal(attempts, 3);
});
