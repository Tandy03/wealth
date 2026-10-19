(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./controllers/wallet-actions') : root.FinoWalletActions,
    typeof module === 'object' && module.exports ? require('../../shared/errors') : root.FinoErrors);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoStateStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (walletRules, errors) {
  const clone = value => JSON.parse(JSON.stringify(value));
  function guardFinancialReads(store, { mode = 'test', onViolation } = {}) {
    const proxies = new WeakMap();
    const fields = new Set(['data', 'assets', 'transactions', 'sales', 'payments', 'wallet', 'rebalance', 'calendarNotes', 'priceHistory', 'instruments',
      'quantity', 'amount', 'price', 'purchasePrice', 'remainingQuantity', 'remainingCostBasis', 'name', 'id', 'months', 'expenses', 'loans', 'plans', 'length', 'type', 'date', 'sync']);
    const child = (path, key) => path + '.' + (fields.has(String(key)) ? String(key) : '[entry]');
    function deny(type, path) {
      const diagnostic = { code: 'DIRECT_STATE_MUTATION', type, path };
      if (mode === 'development') onViolation?.(diagnostic);
      throw new Error(`UI must change financial data through a store command (${type} at ${path}).`);
    }
    function readonly(value, path = 'data') {
      if (!value || typeof value !== 'object') return value;
      if (!proxies.has(value)) proxies.set(value, new Proxy(value, {
        get: (target, key) => readonly(Reflect.get(target, key), child(path, key)),
        getOwnPropertyDescriptor: (target, key) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          return descriptor && 'value' in descriptor ? { ...descriptor, value: readonly(descriptor.value, child(path, key)) } : descriptor;
        },
        set: (_target, key) => deny('set', child(path, key)),
        deleteProperty: (_target, key) => deny('delete', child(path, key)),
        defineProperty: (_target, key) => deny('define', child(path, key)),
        setPrototypeOf: () => deny('prototype', path), preventExtensions: () => deny('preventExtensions', path),
      }));
      return proxies.get(value);
    }
    const state = new Proxy(store.getState(), {
      get: (target, key) => key === 'data' ? readonly(target.data) : Reflect.get(target, key),
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === 'data' && descriptor ? { ...descriptor, value: readonly(descriptor.value) } : descriptor;
      },
      set: (target, key, value) => key === 'data' ? deny('set', 'data') : Reflect.set(target, key, value),
      deleteProperty: (target, key) => key === 'data' ? deny('delete', 'data') : Reflect.deleteProperty(target, key),
      defineProperty: (target, key, descriptor) => key === 'data' ? deny('define', 'data') : Reflect.defineProperty(target, key, descriptor),
      setPrototypeOf: () => deny('prototype', 'state'),
    });
    return { ...store,
      getState: () => state, getData: () => state.data, select: selector => selector(state),
      subscribe: listener => store.subscribe(event => listener({ ...event, state })),
      replaceData: data => readonly(store.replaceData(data)), updateData: change => readonly(store.updateData(change)),
      loadData: async loader => { const result = await store.loadData(loader); return result.data ? { ...result, data: readonly(result.data) } : result; },
      saveWallet: async (...args) => { const result = await store.saveWallet(...args); return { ...result, value: readonly(result.value) }; },
      saveRebalance: async (...args) => { const result = await store.saveRebalance(...args); return { ...result, value: readonly(result.value) }; },
    };
  }
  function createStore({ model, initialState = {}, getScope = () => null, guard = false, onViolation }) {
    function prepare(data) {
      const normalized = model.normalizeState(data);
      walletRules.normalizeCategories(normalized.wallet);
      return normalized;
    }
    const state = { ...initialState, data: prepare(initialState.data || model.createEmptyState()) };
    const subscribers = new Set();
    let revision = 0, epoch = 0, loadSequence = 0, invalidated = false;
    let publishedScope = getScope(), walletQueue = Promise.resolve();
    const versions = { wallet: 0, rebalance: 0 };
    function capture() { return { revision, epoch, scope: getScope() }; }
    function sameContext(token, initial = false) {
      const scope = getScope();
      return token.epoch === epoch && (token.scope === scope || initial && token.scope == null && publishedScope == null);
    }
    function isCurrent(token) { return !invalidated && sameContext(token) && token.revision === revision; }
    function notify(type, keys = [], details = {}) {
      for (const listener of [...subscribers]) {
        try { listener({ type, keys, state, ...details }); }
        catch (error) { console.error('State subscriber failed:', globalThis.FinoErrors?.diagnostics(error) || { code: 'STATE_SUBSCRIBER_FAILURE' }); }
      }
    }
    function publish(data, keys, command, persistence) {
      const normalized = prepare(data);
      state.data = normalized;
      revision++;
      if (!keys.length) { epoch++; publishedScope = getScope(); invalidated = false; }
      for (const key of Object.keys(versions)) if (!keys.length || keys.includes(key)) versions[key]++;
      notify('data:changed', keys, { command, persistence });
      return normalized;
    }
    function replaceData(data) { return publish(data, [], 'replaceData'); }
    function updateData(mutator) {
      const draft = clone(state.data);
      if (mutator(draft)?.then) throw new TypeError('Store mutators must be synchronous.');
      return publish(draft, [], 'updateData');
    }
    function stale(persistence) {
      const error = errors.clientError(new errors.ConflictError({ code: 'STALE_STATE', message: 'The portfolio changed while this operation was pending. Reload before retrying; your input has been kept.' }));
      error.applied = false;
      error.persistence = persistence || { savedLocally: false, savedRemotely: false, backupSaved: false };
      return error;
    }
    function assertWritable(token) {
      if (invalidated || !sameContext(token) || publishedScope !== getScope()) throw stale();
    }
    function outcome(saved) {
      const result = { savedLocally: true, savedRemotely: false, backupSaved: false, ...saved?.persistence };
      if (result.savedLocally !== true) throw new errors.StorageError();
      return result;
    }
    async function loadData(loader) {
      const token = capture(), sequence = ++loadSequence;
      const current = () => sameContext(token, true) && token.revision === revision && sequence === loadSequence;
      let data;
      try { data = await loader(); }
      catch (error) { if (!current()) return { applied: false }; throw error; }
      if (!current() || data?.accountScope != null && data.accountScope !== getScope()) return { applied: false };
      replaceData(data);
      return { applied: true, data: state.data };
    }
    function saveWallet(change, persist) {
      // Capture context when enqueued, not when the previous write completes.
      const token = capture();
      const operation = walletQueue.then(async () => {
        assertWritable(token);
        const version = versions.wallet;
        const draft = clone(state.data.wallet);
        if (change(draft)?.then) throw new TypeError('Store mutators must be synchronous.');
        walletRules.normalizeCategories(draft);
        model.validateEntity('Wallet', draft);
        const saved = await persist(clone(draft));
        const persistence = outcome(saved);
        if (invalidated || !sameContext(token) || version !== versions.wallet) throw stale(persistence);
        const value = saved || draft;
        publish({ ...state.data, wallet: value }, ['wallet'], 'saveWallet', persistence);
        return { applied: true, value: state.data.wallet, persistence };
      });
      walletQueue = operation.catch(() => {});
      return operation;
    }
    async function saveRebalance(request, persist) {
      const token = capture(), version = versions.rebalance;
      assertWritable(token);
      const input = clone(request), draft = {};
      draft.rebalance = state.data.rebalance;
      model.applyRebalance(draft, input);
      const saved = await persist(input);
      const persistence = outcome(saved);
      if (invalidated || !sameContext(token) || version !== versions.rebalance) throw stale(persistence);
      const value = saved || draft.rebalance;
      if (model.rebalanceSignature(value) !== model.rebalanceSignature(input.plan)) throw new errors.ValidationError({ message: 'The saved rebalance plan does not match the requested plan.' });
      publish({ ...state.data, rebalance: value }, ['rebalance'], 'saveRebalance', persistence);
      return { applied: true, value: state.data.rebalance, persistence };
    }
    const store = {
      getState: () => state,
      getData: () => state.data,
      replaceData, updateData, loadData, saveWallet, saveRebalance, capture, isCurrent,
      invalidateContext() { epoch++; loadSequence++; invalidated = true; },
      setUI(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.hasOwn(patch, 'data')) throw new Error('UI updates cannot replace financial data.');
        Object.assign(state, patch);
        notify('ui:changed', Object.keys(patch));
        return state;
      },
      select: selector => selector(state),
      subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function.');
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    };
    return guard ? guardFinancialReads(store, { mode: guard, onViolation }) : store;
  }
  return { createStore, guardFinancialReads };
});
