// Compatibility export. Browser pages load /shared/state-contract.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/state-contract');
  else if (!root.FinoStateContract) throw new Error('Load /shared/state-contract.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
