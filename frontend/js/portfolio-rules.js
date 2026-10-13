(function (root) {
  // Compatibility facade. Financial functions have no DOM or formatting dependencies.
  const modules = typeof module === 'object' && module.exports
    ? [require('./portfolio/calculations'), require('./portfolio/normalization'), require('./portfolio/operations')]
    : [root.FinoPortfolioCalculations, root.FinoPortfolioNormalization, root.FinoPortfolioOperations];
  const rules = Object.assign({}, ...modules);
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.FinoPortfolioRules = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this);
