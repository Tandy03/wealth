// Compatibility export. Browser pages load /shared/validation.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/validation');
  else if (!root.FinoValidation) throw new Error('Load /shared/validation.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
