// Compatibility export. Browser pages load /shared/portfolio/operations.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../../shared/portfolio/operations');
  else if (!root.FinoPortfolioOperations) throw new Error('Load /shared/portfolio/operations.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
