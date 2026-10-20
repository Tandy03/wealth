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
  // Read projections can encounter replayed facts. Never deduplicate unrelated,
  // unlinked rows just because their dates and amounts happen to match.
  function uniqueFinancialRecords(records, kind) {
    const ids = new Set(), operations = new Set();
    return records.filter(record => {
      const operation = record.operationId && JSON.stringify([kind, record.operationId, record.assetId, record.type, record.date || record.sellDate, record.amount ?? record.saleProceeds]);
      if (record.id && ids.has(record.id) || operation && operations.has(operation)) return false;
      if (record.id) ids.add(record.id);
      if (operation) operations.add(operation);
      return true;
    });
  }
  // Historic acquired quantity never describes the current position. Closure is explicit or the balance is zero.
  const assetLifecycle = (asset, remainingQuantity, targetDate) => asset.closedAt && (!targetDate || asset.closedAt.slice(0, 10) <= targetDate) || remainingQuantity <= 1e-10 ? 'closed' : 'open';
  return Object.freeze({ assetTypes, paymentTypes, transactionTypes, isPaymentCompleted, isTransactionCompleted, uniqueFinancialRecords, assetLifecycle,
    costBasisMethod: 'moving_average', dividendRecordRule: 'previous_month_end' });
});
