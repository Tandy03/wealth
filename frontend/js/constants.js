// Compatibility export. Browser pages load /shared/constants.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/constants');
  else if (!root.FinoConstants) throw new Error('Load /shared/constants.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
