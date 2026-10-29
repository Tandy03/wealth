
const implementation = (function () {
  function month(wallet, key) {
    wallet.months ||= {};
    const result = wallet.months[key] ||= {};
    result.plans ||= {};
    result.customCategories ||= [];
    result.notes ||= [];
    return result;
  }
  function createService({ store, api }) {
    return {
      mutate: change => store.saveWallet(change, wallet => api.saveWallet(wallet)),
      planDraftKey: (key, category) => JSON.stringify([store.capture().scope, key, category]),
    };
  }
  // These helpers may mutate only private command drafts, never published values.
  function normalizeCategories(wallet) {
    const replacements = { 'Groceries + household goods': 'Groceries + household', 'Other expenses': 'Other', Savings: 'Save+invest' };
    for (const expense of wallet.expenses || []) expense.category = replacements[expense.category] || expense.category;
    for (const entry of Object.values(wallet.months || {})) {
      for (const [oldName, newName] of Object.entries(replacements)) if (entry.plans?.[oldName] != null) {
        entry.plans[newName] = entry.plans[oldName]; delete entry.plans[oldName];
      }
      entry.customCategories = (entry.customCategories || []).map(name => replacements[name] || name);
    }
    return wallet;
  }
  function cleanupCategories(wallet) {
    for (const [key, entry] of Object.entries(wallet.months || {})) {
      const used = new Set((wallet.expenses || []).filter(expense => String(expense.date).slice(0, 7) === key).map(expense => expense.category));
      entry.customCategories = (entry.customCategories || []).filter(category => {
        if (used.has(category)) return true;
        if (entry.plans) delete entry.plans[category];
        return false;
      });
    }
  }
  return { createService, month, normalizeCategories, cleanupCategories };
})();
export default implementation;
export const { cleanupCategories, createService, month, normalizeCategories } = implementation;
