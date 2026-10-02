const { DAYS_PER_YEAR, MILLISECONDS_PER_DAY } = require('../config/constants');
function maturityPayout(principal, annualRate, purchaseDate, maturityDate) {
  const days = Math.max(0, (new Date(`${maturityDate}T00:00:00`) - new Date(`${purchaseDate}T00:00:00`)) / MILLISECONDS_PER_DAY);
  return principal * (1 + annualRate / 100 * days / DAYS_PER_YEAR);
}
function saleFinancials(quantity, sellPrice, purchasePrice) {
  const costBasis = quantity * purchasePrice;
  const saleProceeds = quantity * sellPrice;
  const profit = saleProceeds - costBasis;
  return { costBasis, saleProceeds, profit, roi: costBasis > 0 ? profit / costBasis * 100 : 0 };
}
module.exports = { maturityPayout, saleFinancials };
