(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../../shared/operations') : root.FinoOperations,
    typeof module === 'object' && module.exports ? require('../../../shared/errors') : root.FinoErrors,
    typeof module === 'object' && module.exports ? require('../../../shared/state-model') : root.FinoStateModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoOutbox = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (operations, errors, model) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const states = ['queued', 'in-flight', 'outcome-unknown', 'confirmed', 'rejected', 'conflict'];
  const pending = entry => ['queued', 'in-flight', 'outcome-unknown'].includes(entry.state);
  const targeted = method => ['buyMoreAsset', 'markPaymentReceived'].includes(method);
  const argsFor = entry => entry.method === 'mergeAssets' ? [clone(entry.body.assetIds), { operationId: entry.operationId }]
    : targeted(entry.method) ? [entry.target, clone(entry.body)] : [clone(entry.body)];
  const conflict = (code, message) => errors.clientError(new errors.ConflictError({ code, message }));
  function noCredentials(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:access.?token|refresh.?token|id.?token|proxy.?token|auth.?token|client.?secret|api.?key|private.?key|token|secret|password|authorization|credentials?|cookie)$/i.test(key)) throw new Error('Credential field in outbox');
      noCredentials(item);
    }
  }
  function validate(entry, scope) {
    if (!entry || typeof entry !== 'object' || entry.scope !== scope || !operations.kinds.includes(entry.method) ||
        !states.includes(entry.state) || typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) ||
        entry.lastAttemptAt !== null && (typeof entry.lastAttemptAt !== 'string' || !Number.isFinite(Date.parse(entry.lastAttemptAt))) ||
        (targeted(entry.method) ? typeof entry.target !== 'string' || !entry.target.trim() : entry.target !== null) ||
        !entry.body || typeof entry.body !== 'object' || Array.isArray(entry.body) || entry.body.operationId !== entry.operationId ||
        entry.intent != null && (typeof entry.intent.key !== 'string' || !entry.intent.key || entry.intent.key.length > 300) ||
        entry.state === 'confirmed' && entry.lastErrorCode !== 'OPERATION_RESULT_EXPIRED' && (!entry.result || typeof entry.result !== 'object' || Array.isArray(entry.result)) ||
        entry.lastErrorCode != null && errors.safeCode(entry.lastErrorCode) !== entry.lastErrorCode) throw new Error('Invalid outbox entry');
    operations.validateId(entry.operationId); model.validateJson(entry); noCredentials(entry);
    const descriptor = operations.describe(entry.method, argsFor(entry));
    if (descriptor.target !== entry.target) throw new Error('Invalid outbox target');
  }
  function createOutbox({ getContext, getScope = () => null, onChange = () => {}, onExpired = async () => {}, now = () => new Date().toISOString() }) {
    let serial = Promise.resolve(), service;
    const active = new Map(), callerCommands = new WeakMap();
    const keyFor = scope => 'fino-command-outbox-v1:' + encodeURIComponent(scope);
    const assertScope = ctx => {
      if (ctx.isCurrent && !ctx.isCurrent()) throw conflict('OUTBOX_SCOPE_CHANGED', 'Return to the original account to review this command.');
    };
    const storageError = cause => errors.clientError(new errors.StorageError({ code: 'OUTBOX_STORAGE_FAILURE', message: 'Could not save the local command recovery record. The command was not sent or its confirmation is still pending.', cause }));
    async function context() {
      let value;
      try { value = await getContext(); }
      catch (cause) {
        if (cause instanceof errors.ApplicationError) throw errors.clientError(cause);
        if (errors.classify(cause) === 'auth_required') throw errors.clientError(new errors.AuthRequiredError({ cause }));
        throw storageError(cause);
      }
      if (typeof value?.scope !== 'string' || !value.scope || !value.storage?.getItem || !value.storage?.setItem) throw storageError();
      return value;
    }
    async function read(ctx) {
      let raw;
      try { raw = await ctx.storage.getItem(keyFor(ctx.scope)); } catch (cause) { throw storageError(cause); }
      if (!raw) return { version: 1, entries: [] };
      try {
        const document = JSON.parse(raw);
        if (document.version !== 1 || !Array.isArray(document.entries)) throw new Error('Invalid outbox');
        const ids = new Set();
        for (const entry of document.entries) { validate(entry, ctx.scope); if (ids.has(entry.operationId)) throw new Error('Duplicate outbox ID'); ids.add(entry.operationId); }
        return document;
      } catch (_) {
        try { await ctx.storage.setItem(keyFor(ctx.scope) + ':diagnostic', JSON.stringify({ code: 'OUTBOX_CORRUPT_RECORD', detectedAt: now() })); } catch (_) { /* retain original data even when diagnostics cannot be written */ }
        throw errors.clientError(new errors.ValidationError({ code: 'OUTBOX_CORRUPT_RECORD', message: 'Local command recovery data is damaged. It has been preserved and will not be sent. Restore or inspect local application data before creating further financial commands.' }));
      }
    }
    async function write(ctx, document) {
      try { await ctx.storage.setItem(keyFor(ctx.scope), JSON.stringify(document)); }
      catch (cause) { throw storageError(cause); }
      try { onChange(); } catch (_) { /* UI notification cannot change a durable outcome */ }
    }
    function locked(ctx, operation) {
      const run = () => ctx.lock ? ctx.lock(keyFor(ctx.scope), operation) : operation();
      const result = serial.then(run); serial = result.catch(() => {}); return result;
    }
    async function recover(ctx, document) {
      let changed = false;
      for (const entry of document.entries) if (entry.state === 'in-flight' && !active.has(ctx.scope + ':' + entry.operationId)) { entry.state = 'outcome-unknown'; changed = true; }
      if (changed) await write(ctx, document);
    }
    async function change(ctx, id, mutate) {
      return locked(ctx, async () => {
        const document = await read(ctx), entry = document.entries.find(item => item.operationId === id);
        if (!entry) throw conflict('OUTBOX_RECORD_MISSING', 'The local recovery record is missing. Reload before retrying.');
        const result = mutate(entry, document); await write(ctx, document); return result;
      });
    }
    async function execute(ctx, request) {
      assertScope(ctx);
      await locked(ctx, async () => {
        const document = await read(ctx); await recover(ctx, document);
        const existing = document.entries.find(entry => entry.operationId === request.operationId);
        if (existing && operations.canonical([existing.method, existing.target, existing.body]) !== operations.canonical([request.method, request.target, request.body])) throw conflict('OPERATION_ID_CONFLICT', 'This command ID already belongs to a different request. Recover the original command.');
        if (!existing) {
          if (request.intent && document.entries.some(entry => pending(entry) && entry.intent?.key === request.intent.key)) throw conflict('OUTBOX_PENDING_COMMAND', 'This form has an unfinished command. Recover its original request before submitting edited input.');
          document.entries.push(request); await write(ctx, document);
        }
      });
      const entry = await change(ctx, request.operationId, record => {
        if (['rejected', 'conflict'].includes(record.state)) throw conflict('OUTBOX_COMMAND_REJECTED', 'This command was rejected. Review the error; only an intentional new command may use a new ID.');
        if (record.state !== 'confirmed') { record.state = 'in-flight'; record.lastAttemptAt = now(); }
        return clone(record);
      });
      if (entry.state === 'confirmed') {
        assertScope(ctx);
        if (entry.lastErrorCode === 'OPERATION_RESULT_EXPIRED') throw conflict('OPERATION_RESULT_EXPIRED', 'The command is recorded but its replay result expired. Reload the portfolio before continuing.');
        return clone(entry.result);
      }
      let committed = false;
      try {
        if ((await context()).scope !== ctx.scope || ctx.isCurrent && !ctx.isCurrent()) throw conflict('OUTBOX_SCOPE_CHANGED', 'Return to the original account to recover this command.');
        const result = await service[entry.method](...argsFor(entry));
        committed = true;
        // Persist acknowledgement before removing it; a crash between these writes
        // leaves a completed record which is never sent again.
        await change(ctx, entry.operationId, record => { record.state = 'confirmed'; record.result = clone(result); record.lastErrorCode = null; });
        if (ctx.isCurrent && !ctx.isCurrent()) throw conflict('OUTBOX_SCOPE_CHANGED', 'The command was confirmed in its original account. Return to that account to review it.');
        try { await change(ctx, entry.operationId, (_record, document) => { assertScope(ctx); document.entries = document.entries.filter(item => item.operationId !== entry.operationId); }); } catch (_) { /* confirmed result remains recoverable */ }
        assertScope(ctx);
        return result;
      } catch (failure) {
        const error = errors.clientError(failure, { fallbackCategory: 'remote_unavailable' });
        const expired = error.code === 'OPERATION_RESULT_EXPIRED';
        const state = expired ? 'confirmed' : committed || error.code === 'OUTBOX_SCOPE_CHANGED' ? 'outcome-unknown' : error.category === 'conflict' ? 'conflict'
          : ['validation', 'access_denied', 'storage_failure', 'auth_required', 'not_found'].includes(error.category) ? 'rejected' : 'outcome-unknown';
        // A failed acknowledgement write leaves the durable in-flight entry intact.
        try { await change(ctx, entry.operationId, record => { if (record.state !== 'confirmed') { record.state = state; record.lastErrorCode = error.code; } }); } catch (_) { /* preserve the earlier durable record */ }
        if (expired) { try { await onExpired(); } catch (_) { /* original replay error remains visible */ } }
        throw error;
      }
    }
    async function submit(method, originalArgs) {
      const initialScope = getScope();
      const index = targeted(method) || method === 'mergeAssets' ? 1 : 0;
      const original = originalArgs[index] || {}, intent = original.commandIntent ? { key: original.commandIntent.key } : undefined;
      const caller = originalArgs[index] && typeof originalArgs[index] === 'object' ? originalArgs[index]
        : method === 'mergeAssets' && Array.isArray(originalArgs[0]) ? originalArgs[0] : null;
      let args;
      try { args = clone(originalArgs); } catch (_) { throw errors.clientError(new errors.ValidationError({ code: 'OUTBOX_INVALID_COMMAND', message: 'The command must contain JSON-compatible financial input.' })); }
      args[index] ||= {};
      const body = method === 'mergeAssets' ? { ...args[1], assetIds: args[0] } : args[index];
      const ctx = await context();
      if (initialScope && initialScope !== ctx.scope) throw conflict('OUTBOX_SCOPE_CHANGED', 'The active account changed before this command could be queued. Reopen the form in its original account.');
      const target = targeted(method) ? args[0] : null;
      const callerSignature = operations.canonical([method, target, body]);
      const previous = caller ? callerCommands.get(caller)?.get(ctx.scope) : null;
      const generated = body.operationId === undefined;
      if (generated) {
        if (previous?.scope === ctx.scope && previous.signature !== callerSignature) {
          const document = await locked(ctx, () => read(ctx));
          if (document.entries.some(entry => entry.operationId === previous.id && pending(entry))) throw conflict('OUTBOX_PENDING_COMMAND', 'Recover the original request before editing an unfinished command.');
        }
        body.operationId = previous?.scope === ctx.scope && previous.signature === callerSignature ? previous.id : operations.newId();
      }
      const request = { operationId: body.operationId, method, target: targeted(method) ? args[0] : null, body,
        scope: ctx.scope, createdAt: now(), lastAttemptAt: null, state: 'queued', lastErrorCode: null, ...(intent ? { intent } : {}) };
      try { validate(request, ctx.scope); } catch (cause) { throw errors.clientError(cause.code ? cause : new errors.ValidationError({ code: 'OUTBOX_INVALID_COMMAND', message: 'The recovery command contains invalid or unsafe data.' })); }
      if (generated && caller) {
        if (!callerCommands.has(caller)) callerCommands.set(caller, new Map());
        callerCommands.get(caller).set(ctx.scope, { scope: ctx.scope, signature: callerSignature, id: body.operationId });
      }
      const key = ctx.scope + ':' + request.operationId;
      const signature = operations.canonical([request.method, request.target, request.body]);
      if (active.has(key)) {
        if (active.get(key).signature !== signature) throw conflict('OPERATION_ID_CONFLICT', 'This command ID already belongs to a different request.');
        return active.get(key).promise;
      }
      const promise = execute(ctx, request).then(result => { if (generated && caller) callerCommands.get(caller)?.delete(ctx.scope); return result; }).finally(() => active.delete(key));
      active.set(key, { promise, signature }); return promise;
    }
    async function list() {
      const ctx = await context();
      return locked(ctx, async () => {
        try {
          const document = await read(ctx);
          if (ctx.isCurrent && !ctx.isCurrent()) throw conflict('OUTBOX_SCOPE_CHANGED', 'The active account changed. Reopen command recovery in the current account.');
          await recover(ctx, document); return { scope: ctx.scope, entries: clone(document.entries), corrupt: false };
        }
        catch (error) { if (error.code !== 'OUTBOX_CORRUPT_RECORD') throw error; return { scope: ctx.scope, entries: [], corrupt: true, code: error.code }; }
      });
    }
    async function retry(operationId, expectedScope) {
      const ctx = await context();
      if (ctx.scope !== expectedScope) throw conflict('OUTBOX_SCOPE_CHANGED', 'Return to the original account to recover this command.');
      const document = await locked(ctx, () => read(ctx));
      const entry = document.entries.find(item => item.operationId === operationId);
      if (!entry || !pending(entry)) throw conflict('OUTBOX_COMMAND_REJECTED', 'Only an unfinished command can be retried.');
      const key = ctx.scope + ':' + operationId;
      if (active.has(key)) return active.get(key).promise;
      const promise = execute(ctx, clone(entry)).finally(() => active.delete(key));
      active.set(key, { promise, signature: operations.canonical([entry.method, entry.target, entry.body]) }); return promise;
    }
    async function dismiss(operationId, expectedScope) {
      const ctx = await context();
      if (ctx.scope !== expectedScope) throw conflict('OUTBOX_SCOPE_CHANGED', 'Return to the original account first.');
      await change(ctx, operationId, (entry, document) => {
        assertScope(ctx);
        if (pending(entry)) throw conflict('OUTBOX_PENDING_COMMAND', 'Recover the unfinished command before removing it.');
        document.entries = document.entries.filter(item => item.operationId !== operationId);
      });
    }
    return { list, retry, dismiss,
      wrap(rawService) {
        service = rawService;
        const wrapped = Object.fromEntries(Object.entries(service).map(([method, invoke]) => [method,
          operations.kinds.includes(method) ? (...args) => submit(method, args) : invoke]));
        Object.defineProperty(wrapped, 'outbox', { value: { list, retry, dismiss } }); return wrapped;
      },
    };
  }
  return { createOutbox };
});
