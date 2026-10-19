// Compatibility export. Browser pages load /shared/market-model.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/market-model');
  else if (!root.FinoMarketModel) throw new Error('Load /shared/market-model.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
