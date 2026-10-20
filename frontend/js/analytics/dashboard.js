(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('../../../shared/portfolio-rules') : root.FinoPortfolioRules, node ? require('../../../shared/state-contract') : root.FinoStateContract);
  if (node) module.exports = api;
  else root.FinoDashboardAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rules, contract) {
  const DAY = 86400000;
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
  const day = date => String(date || '').slice(0, 10);
  const shift = (date, offset) => new Date(Date.parse(date + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
  const receivedDate = record => day(record.receivedDate || record.receivedAt || record.date);
  const regular = record => ['DIVIDEND', 'COUPON'].includes(record.type) && record.recurring !== false && record.isRecurring !== false;
  const finite = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value));
  const indexByAsset = records => {
    const map = new Map();
    for (const record of records) { if (!map.has(record.assetId)) map.set(record.assetId, []); map.get(record.assetId).push(record); }
    return map;
  };

  // Pure read model. Sample shared holdings at financial event boundaries, then
  // convert aggregated native cost bases for at most 365 calendar days.
  function reinvestmentForecast({ data, market, asOf = rules.today() } = {}) {
    const empty = { reason: 'data', scenarios: [], receipts: [], dailyCapital: [], fxUsage: [], issues: {} };
    if (!data || !market?.rateInfo || !validDate(asOf)) return empty;
    const transactions = contract.uniqueFinancialRecords(data.transactions || [], 'transaction');
    const sales = contract.uniqueFinancialRecords(data.sales || [], 'sale');
    const payments = contract.uniqueFinancialRecords(data.payments || [], 'payment');
    const windowStart = shift(asOf, -364);
    const portfolioAssets = (data.assets || []).filter(asset => asset.type !== 'savings');
    // Explicitly closed historical positions have no capital in this window;
    // missing ancient acquisition details must not invalidate a current sample.
    const assets = portfolioAssets.filter(asset => !(validDate(day(asset.closedAt)) && day(asset.closedAt) < windowStart));
    const activeAssetIds = new Set(assets.map(asset => asset.id));
    const allAssets = new Map((data.assets || []).map(asset => [asset.id, asset]));
    const txIndex = indexByAsset(transactions), saleIndex = indexByAsset(sales), paymentIndex = indexByAsset(payments);
    const issues = { history: 0, missingFx: 0, invalidRecords: 0, ambiguousReceipts: 0 };
    let invalidCapitalRecords = 0, invalidIncomeRecords = 0;
    let firstPurchase = null;
    for (const asset of portfolioAssets) {
      const dates = (txIndex.get(asset.id) || []).filter(tx => tx.type === 'BUY' && contract.isTransactionCompleted(tx)).map(tx => day(tx.date));
      if (!activeAssetIds.has(asset.id)) dates.push(day(asset.purchaseDate));
      for (const date of dates) if (validDate(date) && date <= asOf && (!firstPurchase || date < firstPurchase)) firstPurchase = date;
    }
    for (const asset of assets) {
      const buys = (txIndex.get(asset.id) || []).filter(tx => tx.type === 'BUY' && contract.isTransactionCompleted(tx));
      const acquired = buys.reduce((sum, tx) => sum + (finite(tx.quantity) ? Number(tx.quantity) : 0), 0);
      if (!finite(asset.quantity) || Math.abs(Number(asset.quantity) - acquired) > Math.max(1e-8, Math.abs(acquired) * 1e-10)) issues.history++;
      for (const tx of buys) {
        if (!validDate(day(tx.date)) || !finite(tx.quantity) || Number(tx.quantity) <= 0 || !rules.hasCost(tx) ||
            !finite(tx.amount != null ? tx.amount : Number(tx.quantity) * Number(tx.purchasePrice ?? tx.price)) || rules.costOf(tx) < 0) { issues.invalidRecords++; invalidCapitalRecords++; }
        else if (day(tx.date) <= asOf && (!firstPurchase || day(tx.date) < firstPurchase)) firstPurchase = day(tx.date);
      }
      const assetSales = saleIndex.get(asset.id) || [];
      for (const sale of assetSales) if (!validDate(day(sale.sellDate)) || !finite(sale.quantity) || !finite(sale.costBasis) || Number(sale.costBasis) < 0) issues.history++;
      const saleIds = new Set(assetSales.map(sale => sale.id));
      const saleDates = new Set(assetSales.map(sale => JSON.stringify([day(sale.sellDate), Number(sale.quantity)])));
      for (const tx of txIndex.get(asset.id) || []) if (tx.type === 'SELL' && contract.isTransactionCompleted(tx) && !saleIds.has(tx.saleId) &&
          !saleDates.has(JSON.stringify([day(tx.date), Number(tx.quantity)]))) issues.history++;
      if (asset.closedAt && !validDate(day(asset.closedAt))) issues.history++;
    }
    const firstDate = firstPurchase && firstPurchase > windowStart ? firstPurchase : windowStart;
    const observationDays = Math.round((Date.parse(asOf) - Date.parse(firstDate)) / DAY) + 1;
    const inPeriod = date => date >= firstDate && date <= asOf;
    const changes = new Map();
    const change = (date, currency, delta) => {
      if (!changes.has(date)) changes.set(date, new Map());
      const currencies = changes.get(date); currencies.set(currency, (currencies.get(currency) || 0) + delta);
    };
    for (const asset of assets) {
      const scoped = { transactions: txIndex.get(asset.id) || [], sales: saleIndex.get(asset.id) || [], payments: paymentIndex.get(asset.id) || [] };
      const dates = new Set([firstDate, asOf]);
      for (const tx of scoped.transactions) if (tx.type === 'BUY' && contract.isTransactionCompleted(tx) && validDate(day(tx.date)) && inPeriod(day(tx.date))) dates.add(day(tx.date));
      for (const sale of scoped.sales) if (validDate(day(sale.sellDate)) && inPeriod(day(sale.sellDate))) dates.add(day(sale.sellDate));
      for (const payment of scoped.payments) if (payment.type === 'MATURITY' && contract.isPaymentCompleted(payment)) {
        const date = receivedDate(payment); if (!validDate(date)) issues.history++; else if (inPeriod(date)) dates.add(date);
      }
      if (validDate(day(asset.closedAt)) && inPeriod(day(asset.closedAt))) dates.add(day(asset.closedAt));
      let previous = 0;
      for (const date of [...dates].sort()) {
        try {
          const cost = rules.holdingsAtDate(scoped, asset, date).remainingCost;
          change(date, asset.currency || 'UAH', cost - previous); previous = cost;
        } catch (_) { issues.history++; }
      }
    }
    const usage = new Map();
    const convert = (amount, currency, date, method) => {
      const fx = market.rateInfo(currency, date, method);
      const fallback = !fx.date || /fallback|reserve/i.test(fx.source || '');
      const converted = fx.rate > 0 && Number.isFinite(fx.rate) ? amount * fx.rate : NaN;
      if (!Number.isFinite(converted)) {
        if (amount === 0) return { amount: 0, fx, fallback };
        issues.missingFx++;
        const key = JSON.stringify([currency, method, fx.source, 'missing']);
        const group = usage.get(key) || { currency, method, source: fx.source, estimated: true, fallback, minRate: null, maxRate: null, from: fx.date, to: fx.date, count: 0 };
        group.count++; usage.set(key, group);
        return { amount: null, fx, fallback };
      }
      const key = JSON.stringify([currency, method, fx.source, Boolean(fx.estimated), fallback]);
      let group = usage.get(key);
      if (!group) { group = { currency, method, source: fx.source, estimated: Boolean(fx.estimated), fallback, minRate: fx.rate, maxRate: fx.rate, from: fx.date, to: fx.date, appliedFrom: date, appliedTo: date, count: 0 }; usage.set(key, group); }
      group.count++; group.minRate = Math.min(group.minRate, fx.rate); group.maxRate = Math.max(group.maxRate, fx.rate);
      if (fx.date) { group.from = !group.from || fx.date < group.from ? fx.date : group.from; group.to = !group.to || fx.date > group.to ? fx.date : group.to; }
      group.appliedFrom = date < group.appliedFrom ? date : group.appliedFrom; group.appliedTo = date > group.appliedTo ? date : group.appliedTo;
      return { amount: converted, fx, fallback };
    };
    const balances = new Map(), dailyCapital = [];
    let capitalDays = 0, fallbackCapitalDays = 0, estimatedCapitalDays = 0, currentCapital = 0, missingCurrentFx = false, currentCapitalEstimated = false;
    for (let offset = 0; offset < observationDays; offset++) {
      const date = shift(firstDate, offset);
      for (const [currency, delta] of changes.get(date) || []) balances.set(currency, Math.max(0, (balances.get(currency) || 0) + delta));
      let capital = 0, estimated = false, missingFx = false;
      for (const [currency, cost] of balances) if (cost > 0) {
        const result = convert(cost, currency, date, 'operation-date');
        if (result.amount === null) { missingFx = true; continue; }
        capital += result.amount;
        if (result.fallback) fallbackCapitalDays += result.amount;
        if (result.fx.estimated) { estimated = true; estimatedCapitalDays += result.amount; }
      }
      capitalDays += capital; dailyCapital.push({ date, capital, estimated, missingFx });
    }
    for (const [currency, cost] of balances) if (cost > 0) { const result = convert(cost, currency, asOf, 'report-date'); if (result.amount !== null) currentCapital += result.amount; else missingCurrentFx = true; if (result.fx.estimated) currentCapitalEstimated = true; }

    const candidates = payments.filter(payment => contract.isPaymentCompleted(payment) && regular(payment)).map(record => ({ record, origin: 'payment' }));
    const paymentIds = new Set(payments.map(payment => payment.id));
    const signature = record => JSON.stringify([record.assetId, record.type, receivedDate(record), record.currency || allAssets.get(record.assetId)?.currency || 'UAH', Number(record.amount)]);
    const paymentSignatures = new Map();
    for (const { record } of candidates) { const key = signature(record); if (!paymentSignatures.has(key)) paymentSignatures.set(key, []); paymentSignatures.get(key).push(record); }
    for (const tx of transactions) if (regular(tx) && contract.isTransactionCompleted(tx)) {
      if ((allAssets.get(tx.assetId)?.type || tx.assetType) === 'savings') continue;
      if (tx.paymentId && paymentIds.has(tx.paymentId)) continue;
      if (tx.paymentId) { if (inPeriod(receivedDate(tx))) issues.history++; continue; }
      const matching = paymentSignatures.get(signature(tx)) || [];
      if (tx.operationId && matching.some(payment => payment.operationId === tx.operationId)) continue;
      if (matching.some(payment => !tx.operationId || !payment.operationId) && inPeriod(receivedDate(tx))) issues.ambiguousReceipts++;
      candidates.push({ record: tx, origin: 'transaction' });
    }
    const receipts = []; let income = 0, absoluteIncome = 0, fallbackIncome = 0, estimatedIncome = 0;
    for (const { record, origin } of candidates) {
      const asset = allAssets.get(record.assetId), date = receivedDate(record);
      if ((asset?.type || record.assetType) === 'savings') continue;
      if (!validDate(date)) { issues.invalidRecords++; invalidIncomeRecords++; continue; }
      if (!inPeriod(date)) continue;
      if (!asset) issues.history++;
      if (!finite(record.amount) || Number(record.amount) === 0) { issues.invalidRecords++; invalidIncomeRecords++; continue; }
      const currency = record.currency || asset?.currency || 'UAH';
      const conversion = convert(Number(record.amount), currency, date, 'operation-date');
      receipts.push({ id: record.id, assetName: asset?.name || record.assetName || 'Unknown', type: record.type, date, originalAmount: Number(record.amount), currency, amount: conversion.amount, fx: conversion.fx, origin });
      if (conversion.amount === null) continue;
      income += conversion.amount; absoluteIncome += Math.abs(conversion.amount);
      if (conversion.fallback) fallbackIncome += Math.abs(conversion.amount);
      if (conversion.fx.estimated) estimatedIncome += Math.abs(conversion.amount);
    }
    const target = convert(1000, 'USD', asOf, 'report-date');
    const averageCapital = capitalDays / observationDays, averageMonthlyIncome = income * 365 / observationDays / 12;
    const fundedDays = dailyCapital.filter(row => row.capital > 0).length;
    const fallbackCapitalShare = capitalDays > 0 ? fallbackCapitalDays / capitalDays : 0;
    const fallbackIncomeShare = absoluteIncome > 0 ? fallbackIncome / absoluteIncome : 0;
    // No evidence, unusable records and a zero net total are distinct states.
    // None of them confirms a measurable zero income or supports a scenario.
    const incomeState = invalidIncomeRecords || issues.ambiguousReceipts || receipts.some(receipt => receipt.amount === null) || !Number.isFinite(income)
      ? 'invalid' : !receipts.length ? 'missing' : income === 0 ? 'zero-total' : 'available';
    const targetUnavailable = target.fallback || !validDate(target.fx.date) || target.fx.date > asOf || (Date.parse(asOf) - Date.parse(target.fx.date)) / DAY > 7;
    const incomplete = incomeState === 'invalid' || incomeState === 'zero-total' || Object.values(issues).some(count => count > 0) || fallbackCapitalShare >= 0.1 || fallbackIncomeShare >= 0.1 || targetUnavailable;
    const result = { firstDate, lastDate: asOf, windowStart, observationDays, fundedDays, insufficientHistory: !firstPurchase || observationDays < 90 || fundedDays < 90, preliminary: observationDays < 365, income, averageMonthlyIncome, averageCapital, currentCapital, currentCapitalEstimated,
      annualYield: null, requiredCapital: null, additionalInvestment: null, targetMonthlyIncome: target.amount, targetFx: target.fx, targetUnavailable, targetUsd: 1000,
      receipts: receipts.sort((a,b) => b.date.localeCompare(a.date)), dailyCapital, fxUsage: [...usage.values()], issues, incomplete,
      incomeState, incomeComplete: incomeState === 'available',
      capitalComplete: !issues.history && !invalidCapitalRecords && dailyCapital.every(row => !row.missingFx),
      currentCapitalComplete: !issues.history && !invalidCapitalRecords && !missingCurrentFx,
      fallbackCapitalShare, fallbackIncomeShare, estimatedCapitalShare: capitalDays > 0 ? estimatedCapitalDays / capitalDays : 0,
      estimatedIncomeShare: absoluteIncome > 0 ? estimatedIncome / absoluteIncome : 0,
      estimated: observationDays < 365 || [...usage.values()].some(fx => fx.estimated), scenarios: [] };
    if (incomeState !== 'available') return { ...result, income: null, averageMonthlyIncome: null,
      reason: incomeState === 'missing' && !incomplete ? 'income-history' : incomeState === 'zero-total' ? 'income-zero' : 'data' };
    if (![income, capitalDays, averageCapital, averageMonthlyIncome, currentCapital].every(Number.isFinite) || incomplete) return { ...result, reason: 'data' };
    if (!firstPurchase || observationDays < 90 || fundedDays < 90) return { ...result, reason: 'history' };
    if (!(averageCapital > 0)) return { ...result, reason: 'capital' };
    const annualYield = income / averageCapital * 365 / observationDays;
    if (!(annualYield > 0) || !Number.isFinite(annualYield)) return { ...result, annualYield, reason: 'return' };
    const scenarios = [0.5, 1, 1.5].map((multiplier, index) => {
      const rate = annualYield * multiplier, requiredCapital = target.amount * 12 / rate, monthlyIncome = currentCapital * rate / 12;
      return { name: ['conservative','base','optimistic'][index], multiplier, annualYield: rate, requiredCapital,
        additionalInvestment: Math.max(0, requiredCapital - currentCapital), monthlyIncome,
        targetMet: monthlyIncome >= target.amount, shortfall: Math.max(0, target.amount - monthlyIncome) };
    });
    if (scenarios.some(scenario => ![scenario.requiredCapital, scenario.additionalInvestment, scenario.monthlyIncome].every(Number.isFinite))) return { ...result, reason: 'return' };
    return { ...result, annualYield, scenarios, requiredCapital: scenarios[1].requiredCapital, additionalInvestment: scenarios[1].additionalInvestment,
      range: [scenarios[2].additionalInvestment, scenarios[0].additionalInvestment], observedExcess: Math.max(0, averageMonthlyIncome - target.amount),
      currentMonthlyExcess: Math.max(0, scenarios[1].monthlyIncome - target.amount) };
  }
  return { reinvestmentForecast };
});
