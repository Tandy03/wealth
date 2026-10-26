import rules from '../../../shared/portfolio-rules.js';
import contract from '../../../shared/state-contract.js';
import stateModel from '../../../shared/state-model.js';
const implementation = (function (rules, contract, stateModel) {
  const finite = value => !['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const sumKnown = values => values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
  const paymentDate = payment => payment.receivedDate || String(payment.receivedAt || '').slice(0, 10) || null;
  function createModel(data, assetId, { today = rules.today() } = {}) {
    const asset = (data.assets || []).find(item => item.id === assetId);
    if (!asset) return null;
    const currency = asset.currency || 'UAH', holding = rules.holdingsAtDate(data, asset, today);
    const buys = (data.transactions || []).filter(tx => tx.assetId === assetId && tx.type === 'BUY' && contract.isTransactionCompleted(tx));
    const sales = (data.sales || []).filter(sale => sale.assetId === assetId);
    const payments = (data.payments || []).filter(payment => payment.assetId === assetId);
    const received = payments.filter(rules.received), planned = payments.filter(payment => !rules.received(payment) && !(payment.amountPerUnit != null && finite(payment.amount) === 0));
    const maturity = received.find(payment => payment.type === 'MATURITY');
    const closed = contract.assetLifecycle(asset, holding.remainingQuantity, today) === 'closed';
    const costKnown = closed || finite(asset.purchasePrice) !== null || finite(asset.legacyPurchaseCost) !== null || buys.length > 0 && buys.every(rules.hasCost);
    const costBasis = costKnown ? holding.remainingCost : null;
    const soldQuantity = sales.filter(sale => !sale.sellDate || sale.sellDate <= today).reduce((sum, sale) => sum + (finite(sale.quantity) || 0), 0);
    const status = closed ? maturity ? 'Redeemed' : 'Closed' : soldQuantity > 0 ? 'Partially sold' : 'Active';
    const price = finite(asset.currentPrice) > 0 ? finite(asset.currentPrice) : null;
    const marketValue = closed ? 0 : price === null ? null : holding.remainingQuantity * price;
    const unrealized = closed ? 0 : marketValue === null || costBasis === null ? null : marketValue - costBasis;
    const salesResult = sumKnown(sales.filter(sale => !sale.currency || sale.currency === currency).map(sale => sale.type === 'savings' ? 0 : finite(sale.profit)));
    const paymentAmounts = received.filter(payment => (payment.currency || currency) === currency).map(payment => finite(payment.amount));
    const income = received.filter(payment => (payment.currency || currency) === currency && contract.paymentTypes.includes(payment.type)).map(payment => {
      const amount = finite(payment.amount);
      if (amount === null) return null;
      if (payment.type !== 'MATURITY') return amount;
      const cost = finite(payment.costBasis) ?? rules.holdingsAtDate(data, asset, paymentDate(payment) || payment.date || today, { ignoreClosure: true }).remainingCost;
      return amount - cost;
    });
    const operations = (data.transactions || []).filter(tx => tx.assetId === assetId).map((tx, index) => {
      const sale = sales.find(item => item.id && item.id === tx.saleId || item.transactionId && item.transactionId === tx.id);
      const payment = received.find(item => item.id && item.id === tx.paymentId);
      return { ...tx, date: payment ? paymentDate(payment) || tx.date : tx.date, logOrder: index,
        price: finite(tx.type === 'SELL' ? sale?.sellPrice ?? tx.sellPrice ?? tx.price : tx.purchasePrice ?? tx.price),
        costBasis: finite(sale?.costBasis ?? tx.costBasis), profit: finite(sale?.profit ?? tx.profit), currency: tx.currency || currency };
    });
    // Legacy documents may retain a sale/payment without its companion transaction.
    for (const sale of sales) if (!operations.some(tx => sale.id && tx.saleId === sale.id || sale.transactionId && tx.id === sale.transactionId)) {
      operations.push({ id: 'sale:' + sale.id, type: 'SELL', date: sale.sellDate, quantity: finite(sale.quantity), amount: finite(sale.saleProceeds),
        price: finite(sale.sellPrice), costBasis: finite(sale.costBasis), profit: finite(sale.profit), currency: sale.currency || currency,
        logOrder: operations.length, legacy: true });
    }
    for (const payment of received) if (!operations.some(tx => payment.id && tx.paymentId === payment.id)) {
      operations.push({ id: 'payment:' + payment.id, type: payment.type, date: paymentDate(payment), amount: finite(payment.amount),
        currency: payment.currency || currency, logOrder: operations.length, legacy: true });
    }
    // Stable sort retains document/journal order for operations on the same date.
    operations.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.logOrder - b.logOrder);
    const history = (data.priceHistory || []).filter(point => point.assetId === assetId &&
      (!point.currency || point.currency === currency) && finite(point.price) !== null && Number(point.price) >= 0 && stateModel.isDate(point.date) && point.date <= today)
      .map((point, index) => ({ date: point.date, price: Number(point.price), recordedAt: point.recordedAt || point.date,
        source: typeof point.source === 'string' ? point.source : null, index }))
      .map(point => ({ ...point, recordedAt: typeof point.recordedAt === 'string' && Number.isFinite(Date.parse(point.recordedAt)) ? point.recordedAt : point.date }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt) || a.index - b.index);
    const lastSale = [...sales].sort((a, b) => String(a.sellDate || '').localeCompare(String(b.sellDate || ''))).at(-1);
    const sortedBuys = [...buys].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const details = [['Purchase date', asset.purchaseDate, 'date'], ['Currency', currency], ['Instrument', asset.instrumentName], ['Instrument type', asset.instrumentType]];
    const add = (label, value, format = 'text') => { if (value !== undefined && value !== null && value !== '') details.push([label, value, format]); };
    if (asset.paymentMethod) add('Payment method', asset.paymentMethod === 'capitalization' ? 'Capitalization' : asset.paymentMethod === 'cash' ? 'Cash payment' : asset.paymentMethod === 'none' ? 'None' : asset.paymentMethod, 'label');
    if (asset.type === 'ovdp') { add('ISIN', asset.isin); add('Maturity date', asset.maturityDate, 'date'); add('Redemption per unit', asset.redemptionValue, 'money'); }
    if (['inzhur_reit', 's1_reit', 'inzhur_miltech'].includes(asset.type)) {
      add('Dividend per unit', asset.dividendPerUnit, 'money'); add('First dividend date', asset.firstDividendDate, 'date');
      add('Dividend entitlement', asset.dividendRecordRule === 'payment_date' ? 'Payment date' : asset.dividendRecordRule === 'previous_month_end' ? 'Previous month end' : null);
    }
    if (['deposit', 'novapay', 'crypto_earn'].includes(asset.type)) add('Annual rate', asset.annualRate, 'percent');
    if (['deposit', 'novapay'].includes(asset.type)) { add('Maturity date', asset.maturityDate, 'date'); add('Contract maturity amount', asset.maturityAmount, 'money'); }
    if (asset.type === 'deposit') add('Early withdrawal', asset.earlyWithdrawal, 'boolean');
    if (asset.type === 'novapay') add('Term in months', asset.termMonths);
    if (['stock', 'etf', 'crypto_earn'].includes(asset.type)) add('Ticker', asset.ticker || asset.symbol);
    return { asset, currency, holding, costBasis, status, closed, price, marketValue, unrealized,
      unrealizedReturn: costBasis > 0 && unrealized !== null ? unrealized / costBasis * 100 : null,
      initialQuantity: finite(sortedBuys[0]?.quantity), soldQuantity,
      salesResult, receivedAmount: sumKnown(paymentAmounts), receivedIncome: sumKnown(income),
      realized: salesResult === null || sumKnown(income) === null ? null : salesResult + sumKnown(income),
      received: [...received].sort((a, b) => String(paymentDate(b) || '').localeCompare(String(paymentDate(a) || ''))),
      planned: [...planned].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))), operations, history, details: details.filter(([, value]) => value != null && value !== ''),
      quoteDate: asset.lastSyncedAt || asset.priceUpdatedAt || history.at(-1)?.recordedAt || null,
      closedDate: closed ? String(asset.closedAt || paymentDate(maturity || {}) || (!maturity ? lastSale?.sellDate : null) || '').slice(0, 10) || null : null,
      incompleteHistory: buys.some(tx => !tx.date) || !buys.length || finite(asset.quantity) > buys.reduce((sum, tx) => sum + (finite(tx.quantity) || 0), 0),
      unlinkedIncome: (data.transactions || []).filter(tx => tx.assetId === assetId && contract.paymentTypes.includes(tx.type) && !payments.some(payment => payment.id === tx.paymentId)).length,
      mixedCurrency: received.some(payment => payment.currency && payment.currency !== currency) || sales.some(sale => sale.currency && sale.currency !== currency),
      actions: { edit: true, buy: !closed && !asset.closedAt && !maturity,
        sell: !closed && asset.type !== 'novapay' && (asset.type !== 'deposit' || asset.earlyWithdrawal === true) },
    };
  }
  function chartSeries(data, model, { mode = 'price', from = '', to = '' } = {}) {
    if (model.members?.length > 1) {
      const dates = [...new Set(model.members.flatMap(member => member.history.map(point => point.date)))].sort();
      return dates.filter(date => (!from || date >= from) && (!to || date <= to)).map(date => {
        let value = 0, quantity = 0, missing = false;
        const sources = new Set();
        for (const member of model.members) {
          const held = rules.quantityOnDate(data, member.asset, date);
          if (held <= 0) continue;
          const point = member.history.findLast(point => point.date <= date);
          if (!point || member.incompleteHistory) { missing = true; continue; }
          const amount = model.convert(point.price * held, member.currency, model.currency);
          if (amount === null) missing = true;
          else { value += amount; quantity += held; if (point.source) sources.add(point.source); }
        }
        return { date, value: missing ? null : mode === 'value' ? value : quantity > 0 ? value / quantity : null, source: [...sources].join(', ') };
      });
    }
    const points = model.history.filter(point => (!from || point.date >= from) && (!to || point.date <= to));
    return points.map(point => ({ ...point, value: mode === 'value'
      ? model.incompleteHistory ? null : point.price * rules.quantityOnDate(data, model.asset, point.date) : point.price }));
  }
  const groupKey = asset => asset.type + '::' + String(asset.name || '').trim().toLowerCase();
  function createGroupModel(data, assetIds, { convert, ...options } = {}) {
    const anchor = Array.isArray(assetIds) ? assetIds.find(id => (data.assets || []).some(asset => asset.id === id)) : assetIds;
    const seed = (data.assets || []).find(asset => asset.id === anchor);
    if (!seed) return null;
    // Match the existing Portfolio/Dashboard card, including its closed lots.
    // This is a read projection: original positions and financial facts stay intact.
    const members = data.assets.filter(asset => groupKey(asset) === groupKey(seed)).map(asset => createModel(data, asset.id, options));
    if (members.length === 1) return { ...members[0], ids: [seed.id], members };
    const currencies = [...new Set(members.map(member => member.currency))];
    const currency = currencies.length === 1 ? currencies[0] : 'USD';
    const exchange = (value, from, to = currency) => value === null ? null : from === to ? value : convert ? finite(convert(value, from, to)) : null;
    const total = key => sumKnown(members.map(member => exchange(member[key], member.currency)));
    const remainingQuantity = members.reduce((sum, member) => sum + member.holding.remainingQuantity, 0);
    const purchasedQuantity = members.reduce((sum, member) => sum + member.holding.purchasedQuantity, 0);
    const costBasis = total('costBasis'), marketValue = total('marketValue'), unrealized = total('unrealized');
    const closed = members.every(member => member.closed);
    const soldQuantity = members.reduce((sum, member) => sum + member.soldQuantity, 0);
    const asset = { ...seed };
    for (const field of ['ticker', 'symbol', 'isin', 'instrumentName']) asset[field] = [...new Set(members.map(member => member.asset[field]).filter(Boolean))].join(' · ');
    asset.coupons = []; // Per-position terms are projected below, never borrowed from the first lot.
    const details = [], seen = new Set();
    for (const member of members) {
      for (const row of member.details) {
        const [label, value, format] = row, key = JSON.stringify([label, value, format, format === 'money' ? member.currency : '']);
        if (seen.has(key)) continue;
        seen.add(key);
        const varies = members.some(other => other.details.some(item => item[0] === label && JSON.stringify(item.slice(1)) !== JSON.stringify(row.slice(1))));
        details.push([varies ? `${label} — ${member.asset.instrumentName || member.currency} · ${member.asset.purchaseDate || ''}` : label, value, format, member.currency]);
      }
      for (const coupon of member.asset.coupons || []) {
        const key = JSON.stringify(['coupon', coupon.date, coupon.amountPerUnit, member.currency]);
        if (!seen.has(key)) { seen.add(key); details.push(['Coupon · ' + coupon.date, coupon.amountPerUnit, 'money', member.currency]); }
      }
    }
    function payouts(key) {
      const grouped = new Map();
      for (const member of members) for (const payment of member[key]) {
        const currency = payment.currency || member.currency;
        const recordDate = payment.recordDate || (payment.type === 'DIVIDEND' && stateModel.isDate(payment.date) ? rules.dividendRecordDate(member.asset, payment) : '');
        const identity = JSON.stringify([payment.type, payment.date, key === 'received' ? paymentDate(payment) : '', currency, recordDate]);
        const existing = grouped.get(identity);
        if (existing) { existing.amount = sumKnown([existing.amount, finite(payment.amount)]); existing.paymentIds.push(payment.id); }
        else grouped.set(identity, { ...payment, currency, recordDate, amount: finite(payment.amount), paymentIds: [payment.id] });
      }
      return [...grouped.values()].sort((a, b) => key === 'received' ? String(paymentDate(b) || '').localeCompare(String(paymentDate(a) || '')) : String(a.date || '').localeCompare(String(b.date || '')));
    }
    const order = new Map((data.transactions || []).map((tx, index) => [tx.id, index]));
    const operations = members.flatMap(member => member.operations.map(operation => ({ ...operation, assetId: member.asset.id, instrumentName: member.asset.instrumentName,
      logOrder: order.get(operation.id) ?? order.size + operation.logOrder })))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.logOrder - b.logOrder);
    const quoteMembers = closed ? members : members.filter(member => !member.closed);
    const quoteDates = quoteMembers.map(member => member.quoteDate).filter(Boolean).sort();
    const historicalPrice = closed ? sumKnown(members.map(member => exchange(member.price, member.currency) === null ? null : exchange(member.price, member.currency) * member.holding.purchasedQuantity)) : null;
    return { asset, ids: members.map(member => member.asset.id), members, currency, currencies, convert: exchange,
      holding: { purchasedQuantity, remainingQuantity, remainingCost: costBasis, averagePrice: remainingQuantity > 0 && costBasis !== null ? costBasis / remainingQuantity : 0 },
      costBasis, marketValue, unrealized, unrealizedReturn: costBasis > 0 && unrealized !== null ? unrealized / costBasis * 100 : null,
      price: remainingQuantity > 0 && marketValue !== null ? marketValue / remainingQuantity : closed && historicalPrice !== null && purchasedQuantity > 0 ? historicalPrice / purchasedQuantity : null,
      initialQuantity: sumKnown(members.map(member => member.initialQuantity)), soldQuantity,
      salesResult: total('salesResult'), receivedAmount: total('receivedAmount'), receivedIncome: total('receivedIncome'), realized: total('realized'),
      received: payouts('received'), planned: payouts('planned'), operations, details,
      history: members.flatMap(member => member.history).sort((a, b) => a.date.localeCompare(b.date)),
      closed, status: closed ? members.some(member => member.status === 'Redeemed') ? 'Redeemed' : 'Closed' : soldQuantity > 0 || members.some(member => member.closed) ? 'Partially sold' : 'Active',
      closedDate: closed && members.every(member => member.closedDate) ? members.map(member => member.closedDate).sort().at(-1) : null,
      quoteDate: quoteDates.length === quoteMembers.length ? quoteDates[0] : null,
      incompleteHistory: members.some(member => member.incompleteHistory), unlinkedIncome: members.reduce((sum, member) => sum + member.unlinkedIncome, 0), mixedCurrency: members.some(member => member.mixedCurrency),
      actions: { edit: true, buy: members.some(member => member.actions.buy), sell: members.some(member => member.actions.sell) } };
  }
  return { createModel, createGroupModel, groupKey, chartSeries, finite, paymentDate };
})(rules, contract, stateModel);
export default implementation;
export const { chartSeries, createGroupModel, createModel, finite, groupKey, paymentDate } = implementation;
