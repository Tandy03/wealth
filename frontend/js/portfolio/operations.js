(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calculations'), require('./normalization'), require('../errors'));
  else root.FinoPortfolioOperations = factory(root.FinoPortfolioCalculations, root.FinoPortfolioNormalization, root.FinoErrors);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (calculations, normalization, errors) {
  const { number, day, today, received, assetFor, hasCost, costOf, purchases, holdingsAtDate, quantityOnDate, dividendRecordDate, quantityForSale, consumeLots, maturityPayout } = calculations;
  function canEditPurchase(data, asset, patch) {
    const buys = (data.transactions || []).filter(tx => tx.assetId === asset.id && tx.type === 'BUY');
    const sold = (data.sales || []).some(sale => sale.assetId === asset.id);
    if (patch.currency !== undefined && String(patch.currency).trim().toUpperCase() !== (asset.currency || 'UAH')) return false;
    if (!sold && buys.length <= 1) return true;
    return ['quantity', 'purchasePrice', 'purchaseDate'].every(key => patch[key] === undefined || (key === 'purchaseDate' ? patch[key] === asset[key] : number(patch[key]) === number(asset[key])));
  }
  function identity(asset, { instrument = true } = {}) {
    const fields = ['type', 'name', 'currency', 'isin', 'maturityDate', 'annualRate', 'termMonths', 'earlyWithdrawal', 'dividendPerUnit', 'dividendRecordRule', 'maturityAmountPerUnit'];
    if (instrument) fields.push('instrumentName', 'instrumentType');
    const values = fields.map(key => String(asset[key] ?? (key === 'currency' ? 'UAH' : key === 'dividendRecordRule' ? 'previous_month_end' : '')).trim().toLowerCase());
    const ticker = String(asset.ticker || '').trim().toUpperCase(), symbol = String(asset.symbol || '').trim().toUpperCase();
    values.push(JSON.stringify([ticker || symbol, ticker && symbol && ticker !== symbol ? symbol : '']));
    values.push(asset.type === 'ovdp' ? number(asset.redemptionValue) || 1000 : '');
    values.push(JSON.stringify((asset.coupons || []).map(c => [c.date, number(c.amountPerUnit)]).sort((a, b) => a[0].localeCompare(b[0]))));
    return JSON.stringify(values);
  }
  function refreshPayments(data, assetId) {
    for (const payment of data.payments || []) {
      if ((assetId && payment.assetId !== assetId) || received(payment)) continue;
      const asset = assetFor(data, payment.assetId);
      if (!asset || payment.amountPerUnit == null || !payment.date) continue;
      if (!['COUPON', 'DIVIDEND', 'MATURITY'].includes(payment.type)) continue;
      const date = payment.type === 'DIVIDEND' ? dividendRecordDate(asset, payment) : payment.date;
      const eligible = quantityOnDate(data, asset, date);
      const paid = (data.payments || []).filter(p => p.assetId === asset.id && p.type === payment.type && p.date === payment.date && received(p)).reduce((sum, p) => sum + number(p.amount), 0);
      payment.amount = Math.max(0, number(payment.amountPerUnit) * eligible - paid);
    }
    return data;
  }
  function rebuildPayments(data, asset, createId) {
    const existing = (data.payments || []).filter(payment => payment.assetId === asset.id);
    const scheduled = new Map();
    const key = payment => [payment.type, payment.date, payment.currency || asset.currency || 'UAH', payment.recordDate || ''].join('|');
    const add = payment => scheduled.set(key(payment), { ...payment });
    // Preserve manual schedules as well as provider schedules. Collapse duplicate
    // per-unit entries; receipt rows remain distinct immutable historical records.
    for (const payment of existing) if (!received(payment)) add(payment);
    if (['inzhur_reit', 's1_reit'].includes(asset.type) && asset.firstDividendDate) {
      const start = new Date(asset.firstDividendDate + 'T00:00:00Z');
      for (let i = 0; i < 24; i++) {
        const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 10)).toISOString().slice(0, 10);
        if (date >= asset.firstDividendDate) add({ type: 'DIVIDEND', date, amountPerUnit: number(asset.dividendPerUnit) });
      }
    }
    if (asset.type === 'ovdp') {
      for (const coupon of asset.coupons || []) add({ type: 'COUPON', date: coupon.date, amountPerUnit: number(coupon.amountPerUnit) });
      if (asset.maturityDate) add({ type: 'MATURITY', date: asset.maturityDate, amountPerUnit: number(asset.redemptionValue) || 1000 });
    }
    if (['deposit', 'novapay'].includes(asset.type) && asset.maturityDate) {
      const quantity = quantityOnDate(data, asset, asset.maturityDate);
      const holding = holdingsAtDate(data, asset, asset.maturityDate);
      const amountPerUnit = asset.type === 'deposit'
        ? maturityPayout(holding.remainingCost, number(asset.annualRate), asset.purchaseDate, asset.maturityDate) / (quantity || 1)
        : number(asset.maturityAmountPerUnit ?? existing.find(p => p.type === 'MATURITY')?.amountPerUnit ?? number(asset.maturityAmount) / (number(asset.quantity) || 1));
      add({ type: 'MATURITY', date: asset.maturityDate, amountPerUnit });
    }
    data.payments = (data.payments || []).filter(payment => payment.assetId !== asset.id || received(payment));
    for (const payment of scheduled.values()) {
      const original = existing.find(p => !received(p) && key(p) === key(payment));
      data.payments.push({ id: original?.id || createId('payment'), createdAt: original?.createdAt || new Date().toISOString(), assetId: asset.id, assetName: asset.name, currency: asset.currency || 'UAH', status: 'planned', ...payment });
    }
    refreshPayments(data, asset.id);
    data.payments = data.payments.filter(payment => payment.assetId !== asset.id || received(payment) || !(payment.amountPerUnit != null && payment.amount === 0));
    return data;
  }
  function recordTransaction(data, asset, transaction, createId) {
    if (transaction.type === 'BUY') {
      if (asset.closedAt || data.payments.some(payment => payment.assetId === asset.id && payment.type === 'MATURITY' && received(payment))) throw new errors.ValidationError({ message: 'A redeemed position cannot accept purchases.' });
      normalization.completeLegacyPurchases(data, asset, createId);
      asset.quantity = number(asset.quantity) + number(transaction.quantity);
      transaction.purchasePrice = transaction.amount / transaction.quantity;
    } else if (transaction.type === 'SELL') {
      if (asset.type === 'novapay' || asset.type === 'deposit' && !asset.earlyWithdrawal || number(transaction.quantity) > quantityForSale(data, asset, transaction.date)) throw new errors.ValidationError({ message: 'Not enough units available or the position cannot be sold.' });
      const average = holdingsAtDate(data, asset, transaction.date).averagePrice;
      const costBasis = number(transaction.quantity) * average, proceeds = number(transaction.amount);
      const sale = { id: createId('sale'), assetId: asset.id, assetName: asset.name, type: asset.type, currency: asset.currency || 'UAH',
        createdAt: transaction.createdAt, sellDate: transaction.date, quantity: transaction.quantity, sellPrice: proceeds / transaction.quantity,
        purchasePrice: average, costBasis, saleProceeds: proceeds, profit: proceeds - costBasis, roi: costBasis ? (proceeds - costBasis) / costBasis * 100 : 0, costBasisMethod: 'moving_average' };
      data.sales.push(sale); transaction.saleId = sale.id; transaction.costBasis = costBasis; transaction.costBasisMethod = 'moving_average';
    } else {
      let payment = data.payments.find(item => item.id === transaction.paymentId);
      if (!payment) { payment = { id: createId('payment'), assetId: asset.id, assetName: asset.name, type: transaction.type, date: transaction.date, currency: transaction.currency }; data.payments.push(payment); }
      if (payment.type === 'MATURITY') { payment.costBasis ??= holdingsAtDate(data, asset, transaction.date).remainingCost; asset.closedAt = transaction.date; }
      payment.status = 'received'; payment.amount = transaction.amount; payment.receivedDate = transaction.date; payment.receivedAt = transaction.createdAt;
      transaction.paymentId = payment.id;
    }
    transaction.status = 'completed'; data.transactions.push(transaction);
    normalization.updateHolding(data, asset); refreshPayments(data, asset.id);
    return transaction;
  }
  return { canEditPurchase, identity, refreshPayments, rebuildPayments, recordTransaction };
});
