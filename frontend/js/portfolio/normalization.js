// Compatibility export. Browser pages load /shared/portfolio/normalization.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../../shared/portfolio/normalization');
  else if (!root.FinoPortfolioNormalization) throw new Error('Load /shared/portfolio/normalization.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
