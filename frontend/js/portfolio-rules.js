// Compatibility export. Browser pages load /shared/portfolio-rules.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/portfolio-rules');
  else if (!root.FinoPortfolioRules) throw new Error('Load /shared/portfolio-rules.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
