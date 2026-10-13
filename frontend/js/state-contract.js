(function (root, factory) {
  const contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  else root.FinoStateContract = contract;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const assetTypes = ['ovdp', 'inzhur_reit', 's1_reit', 'inzhur_miltech', 'etf', 'stock', 'savings', 'novapay', 'deposit', 'crypto_earn'];
  const paymentTypes = ['DIVIDEND', 'COUPON', 'MATURITY'];
  const transactionTypes = ['BUY', 'SELL', ...paymentTypes];
  const isPaymentCompleted = payment => ['received', 'paid'].includes(payment.status) || payment.received === true;
  const isTransactionCompleted = transaction => transaction.status == null || ['completed', 'posted'].includes(transaction.status);
  // Historic acquired quantity never describes the current position. Closure is explicit or the balance is zero.
  const assetLifecycle = (asset, remainingQuantity, targetDate) => asset.closedAt && (!targetDate || asset.closedAt.slice(0, 10) <= targetDate) || remainingQuantity <= 1e-10 ? 'closed' : 'open';
  return Object.freeze({ assetTypes, paymentTypes, transactionTypes, isPaymentCompleted, isTransactionCompleted, assetLifecycle,
    costBasisMethod: 'moving_average', dividendRecordRule: 'previous_month_end' });
});
