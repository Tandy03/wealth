// Compatibility facade: forms and controllers retain the existing api methods.
const apiFetchers = FinoFetchers.createService({
  fetch: (...args) => window.mobileApi ? window.FinoRequest.fetchWithTimeout(...args) : window.fetch(...args),
  recoverSession: () => !window.mobileApi,
});
const api = FinoMobileApi.createFacade({
  desktop: FinoDesktopApi.createService(apiFetchers),
  mobile: FinoMobileApi.createService({ getAdapter: () => window.mobileApi, ...apiFetchers }),
  isNative: () => Boolean(window.mobileApi),
  outbox: FinoOutbox.createOutbox({
    getScope: () => window.mobileApi ? window.mobileApi.localCommandScope : 'desktop:' + window.location.origin,
    getContext: async () => {
      if (window.mobileApi) {
        const context = await window.mobileApi.getCommandContext();
        return { ...context, storage: window.mobileApi.commandStorage, isCurrent: () => window.mobileApi.localAccountScope === context.account };
      }
      return { scope: 'desktop:' + window.location.origin, storage: window.localStorage,
        lock: window.navigator.locks ? (key, action) => window.navigator.locks.request(key, action) : null };
    },
    onChange: () => document.dispatchEvent(new CustomEvent('fino:outbox-changed')),
    onExpired: () => loadData(),
  }),
});
const readApiJson = FinoFetchers.readJson;

// A form retry keeps its command identity; an explicit reset starts a new intent.
const financialCommandDrafts = new WeakMap(), financialCommandForms = new WeakSet();
function financialCommand(form, method, body, target = null, options = {}) {
  const operations = window.FinoOperations;
  const preview = { ...body, operationId: 'preview' };
  const args = method === 'mergeAssets' ? [body.assetIds, preview] : ['buyMoreAsset', 'markPaymentReceived'].includes(method) ? [target, preview] : [preview];
  const identity = options.identity || [method, target, operations.describe(method, args).command];
  const scope = window.mobileApi ? window.mobileApi.localAccountScope || null : 'desktop';
  const signature = operations.canonical([scope, identity]);
  if (!financialCommandForms.has(form)) {
    financialCommandForms.add(form);
    form.addEventListener('reset', () => financialCommandDrafts.delete(form));
  }
  let drafts = financialCommandDrafts.get(form);
  if (!drafts) { drafts = new Map(); financialCommandDrafts.set(form, drafts); }
  const slot = options.slot || method, previous = drafts.get(slot);
  const expose = command => {
    const value = JSON.parse(JSON.stringify(command));
    Object.defineProperty(value.body, 'commandIntent', { value: { key: (form.id || 'financial-form') + ':' + slot, signature } });
    return value;
  };
  if (previous?.signature === signature) return expose(previous.command);
  const command = { method, target, body: JSON.parse(JSON.stringify({ ...body, operationId: operations.newId() })) };
  drafts.set(slot, { signature, command });
  return expose(command);
}
