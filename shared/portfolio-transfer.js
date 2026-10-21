(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./state-model') : root.FinoStateModel,
    typeof module === 'object' && module.exports ? require('./sync-model') : root.FinoSyncModel,
    typeof module === 'object' && module.exports ? require('./errors') : root.FinoErrors);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoPortfolioTransfer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model, sync, errors) {
  const MAX_BYTES = 1024 * 1024;
  const fail = message => { throw new errors.ValidationError({ message }); };
  function size(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) fail('Portfolio files must be JSON of at most 1 MiB.');
  }
  function financialDocument(value) {
    const result = model.normalizeState(value);
    // Sync confirmation/device metadata belongs to the destination installation.
    delete result.sync;
    return result;
  }
  const contentChecksum = value => sync.checksum(financialDocument(value));
  function assertEmpty(value) {
    const data = financialDocument(value), empty = model.createEmptyState();
    const vacant = value => value == null || Array.isArray(value) && value.length === 0 || value && typeof value === 'object' && Object.keys(value).length === 0;
    if (Object.keys(data).some(key => key !== 'schemaVersion' && !vacant(data[key]) && sync.signature(data[key]) !== sync.signature(empty[key])))
      throw new errors.ConflictError({ code: 'RESTORE_NOT_EMPTY', message: 'Restore requires an empty portfolio. Existing data was preserved.' });
  }
  async function createExport(value, now = new Date().toISOString()) {
    const unsigned = { format: 'fino-portfolio', version: 1, createdAt: now, document: financialDocument(value) };
    if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(now) || !Number.isFinite(Date.parse(now))) fail('Invalid portfolio export date.');
    const result = { ...unsigned, checksum: await sync.checksum(unsigned) };
    size(JSON.stringify(result, null, 2));
    return result;
  }
  async function validateExport(value) {
    let file = value;
    if (typeof value === 'string') {
      size(value);
      try { file = JSON.parse(value); } catch (_) { fail('The portfolio file is not valid JSON.'); }
    }
    model.validateJson(file);
    if (!file || Array.isArray(file) || file.format !== 'fino-portfolio' || file.version !== 1 ||
        Object.keys(file).some(key => !['format', 'version', 'createdAt', 'document', 'checksum'].includes(key)) ||
        typeof file.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(file.checksum) ||
        typeof file.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(file.createdAt) || !Number.isFinite(Date.parse(file.createdAt))) fail('Unsupported portfolio file format or version.');
    size(JSON.stringify(file, null, 2));
    const { checksum, ...unsigned } = file;
    if (await sync.checksum(unsigned) !== checksum) fail('Portfolio checksum does not match. The file may be damaged.');
    const { document: restored } = file;
    const data = financialDocument(restored);
    return { file: JSON.parse(JSON.stringify(file)), data, checksum, createdAt: file.createdAt, counts: sync.summary(data).counts };
  }
  async function preview(value, target, scope = '') {
    const validated = await validateExport(value);
    assertEmpty(target);
    return { checksum: validated.checksum, createdAt: validated.createdAt, counts: validated.counts,
      expected: await sync.checksum({ scope, document: financialDocument(target) }) };
  }
  async function restoreInput(body, target, scope = '') {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['backup', 'expected'].includes(key)) ||
        typeof body.expected !== 'string' || !/^[a-f0-9]{64}$/.test(body.expected)) fail('A validated portfolio preview is required before restore.');
    const checked = await preview(body.backup, target, scope);
    if (checked.expected !== body.expected) throw new errors.ConflictError({ code: 'RESTORE_PREVIEW_STALE', message: 'The destination changed. Check the portfolio file again before restoring.' });
    return (await validateExport(body.backup)).data;
  }
  return { MAX_BYTES, document: financialDocument, contentChecksum, assertEmpty, createExport, validateExport, preview, restoreInput };
});
