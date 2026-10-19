// Compatibility export. Browser pages load /shared/portfolio/calculations.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../../shared/portfolio/calculations');
  else if (!root.FinoPortfolioCalculations) throw new Error('Load /shared/portfolio/calculations.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
