// Compatibility export. Browser pages load /shared/state-model.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/state-model');
  else if (!root.FinoStateModel) throw new Error('Load /shared/state-model.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
