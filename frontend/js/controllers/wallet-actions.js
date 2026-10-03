(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoWalletActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function month(wallet, key) {
    wallet.months ||= {};
    const result = wallet.months[key] ||= {};
    result.plans ||= {};
    result.customCategories ||= [];
    result.notes ||= [];
    return result;
  }
  function createService({ store, api }) {
    let queue = Promise.resolve();
    function mutate(change) {
      const operation = queue.then(async () => {
        const snapshot = store.getData();
        const draft = JSON.parse(JSON.stringify(snapshot.wallet));
        change(draft);
        const saved = await api.saveWallet(draft);
        // A reload/account switch while awaiting storage owns the newer state.
        if (store.getData() !== snapshot) return false;
        store.updateData(data => { data.wallet = saved || draft; });
        return true;
      });
      queue = operation.catch(() => {});
      return operation;
    }
    return { mutate };
  }
  return { createService, month };
});
