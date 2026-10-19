// Compatibility export. Browser pages load /shared/errors.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/errors');
  else if (!root.FinoErrors) throw new Error('Load /shared/errors.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
