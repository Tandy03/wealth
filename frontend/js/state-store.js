(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoStateStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createStore({ model, initialState = {} }) {
    const state = { ...initialState, data: model.normalizeState(initialState.data || model.createEmptyState()) };
    const subscribers = new Set();
    function notify(type, keys = []) {
      for (const listener of [...subscribers]) {
        try { listener({ type, keys, state }); }
        catch (error) { console.error('State subscriber failed:', error); }
      }
    }
    function replaceData(data) {
      const normalized = model.normalizeState(data);
      state.data = normalized;
      notify('data:changed');
      return normalized;
    }
    return {
      getState: () => state,
      getData: () => state.data,
      replaceData,
      updateData(mutator) {
        const draft = model.normalizeState(state.data);
        mutator(draft);
        return replaceData(draft);
      },
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
  }
  return { createStore };
});
