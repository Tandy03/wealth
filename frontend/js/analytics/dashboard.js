(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoDashboardAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function reinvestmentForecast({ totalProfit, investedCapital, firstDate, usdRate, now = Date.now() }) {
    if (!firstDate || investedCapital <= 0) return { reason: 'history' };
    const startedAt = new Date(`${firstDate}T00:00:00`).getTime();
    if (!Number.isFinite(startedAt)) return { reason: 'history' };
    const elapsedMonths = Math.max(1, (now - startedAt) / (30.4375 * 86400000));
    const averageMonthlyProfit = totalProfit / elapsedMonths;
    const monthlyReturnRate = averageMonthlyProfit / investedCapital;
    if (monthlyReturnRate <= 0) return { reason: 'return', averageMonthlyProfit };
    return { averageMonthlyProfit, additionalInvestment: Math.max(0, 1000 * usdRate / monthlyReturnRate - investedCapital) };
  }
  return { reinvestmentForecast };
});
