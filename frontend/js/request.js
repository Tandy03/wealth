// Compatibility export. Browser pages load /shared/request.js before legacy consumers.
(function (root) {
  if (typeof module === 'object' && module.exports) module.exports = require('../../shared/request');
  else if (!root.FinoRequest) throw new Error('Load /shared/request.js before this compatibility script.');
})(typeof globalThis !== 'undefined' ? globalThis : this);
