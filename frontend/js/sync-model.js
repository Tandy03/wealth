// Compatibility export. Browser pages load /shared/sync-model.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/sync-model');
  else if (!root.FinoSyncModel) throw new Error('Load /shared/sync-model.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
