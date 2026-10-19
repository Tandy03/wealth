// Compatibility export. Browser pages load /shared/portfolio/validation.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../../shared/portfolio/validation');
  else if (!root.FinoOperationValidation) throw new Error('Load /shared/portfolio/validation.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
