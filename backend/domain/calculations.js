const { DAYS_PER_YEAR, MILLISECONDS_PER_DAY } = require('../config/constants');
const { maturityPayout } = require('../../frontend/js/portfolio-rules');
function saleFinancials(quantity, sellPrice, purchasePrice) {
  const costBasis = quantity * purchasePrice;
  const saleProceeds = quantity * sellPrice;
  const profit = saleProceeds - costBasis;
  return { costBasis, saleProceeds, profit, roi: costBasis > 0 ? profit / costBasis * 100 : 0 };
}
module.exports = { maturityPayout, saleFinancials };
