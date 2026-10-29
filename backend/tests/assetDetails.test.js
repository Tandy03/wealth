const test = require('node:test');
const assert = require('node:assert/strict');
const detail = require('../../frontend/js/asset-detail/model');
const rules = require('../../shared/portfolio-rules');
const model = require('../../shared/state-model');
const constants = require('../../shared/constants');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return { ...model.createEmptyState(), assets: [{ id: 'a', name: 'Holding A', type: 'stock', quantity: 15, purchasePrice: 150, currentPrice: 180, purchaseDate: '2026-01-01', currency: 'USD', ticker: 'TEST' },
    { id: 'b', name: 'Holding B', type: 'stock', quantity: 20, purchasePrice: 100, currency: 'USD' }],
    transactions: [{ id: 'buy-1', assetId: 'a', type: 'BUY', quantity: 10, amount: 1000, purchasePrice: 100, date: '2026-01-01' },
      { id: 'sell', assetId: 'a', type: 'SELL', saleId: 's', quantity: 5, amount: 600, costBasis: 500, profit: 100, date: '2026-02-01' },
      { id: 'buy-2', assetId: 'a', type: 'BUY', quantity: 5, amount: 1000, purchasePrice: 200, date: '2026-03-01' },
      { id: 'income', assetId: 'a', type: 'COUPON', paymentId: 'p', amount: 30, date: '2026-03-10' }],
    sales: [{ id: 's', groupId: 'group', assetId: 'a', quantity: 5, costBasis: 500, profit: 100, sellPrice: 120, saleProceeds: 600, sellDate: '2026-02-01', currency: 'USD' },
      { id: 's-b', groupId: 'group', assetId: 'b', quantity: 2, costBasis: 200, profit: 1000, saleProceeds: 1200, sellDate: '2026-02-01', currency: 'USD' }],
    payments: [{ id: 'p', assetId: 'a', type: 'COUPON', amount: 30, date: '2026-03-01', receivedDate: '2026-03-10', status: 'received', currency: 'USD' },
      { id: 'div', assetId: 'a', type: 'DIVIDEND', amount: 20, date: '2026-03-15', received: true, currency: 'USD' },
      { id: 'next', assetId: 'a', type: 'DIVIDEND', amount: 500, date: '2026-12-01', status: 'planned', recordDate: '2026-11-30', currency: 'USD' }],
    priceHistory: ['2026-01-15','2026-02-15','2026-03-15'].map((date, i) => ({ id: 'price-' + i, assetId: 'a', date, price: [100,120,180][i], currency: 'USD', source: 'fixture' })) };
}
test('asset detail reuses remaining holdings rules, preserves stored sale results and counts received payments once', () => {
  const data = fixture(), original = clone(data), result = detail.createModel(data, 'a', { today: '2026-10-19' });
  assert.deepEqual(result.holding, rules.holdingsAtDate(data, 'a', '2026-10-19'));
  assert.equal(result.holding.purchasedQuantity, 15); assert.equal(result.initialQuantity, 10); assert.equal(result.soldQuantity, 5);
  assert.equal(result.holding.remainingQuantity, 10); assert.equal(result.costBasis, 1500);
  assert.equal(result.marketValue, 1800); assert.equal(result.unrealized, 300); assert.equal(result.unrealizedReturn, 20);
  assert.equal(result.status, 'Partially sold'); assert.equal(result.salesResult, 100);
  assert.equal(result.receivedAmount, 50); assert.equal(result.receivedIncome, 50); assert.equal(result.realized, 150);
  assert.equal(result.operations.filter(item => item.type === 'COUPON').length, 1);
  assert.equal(result.operations.filter(item => item.type === 'SELL').length, 1);
  assert.equal(result.operations.find(item => item.type === 'SELL').amount, 600, 'The grouped-sale total must not leak into the individual holding.');
  data.assets[0].currentPrice = 999; data.assets[0].purchasePrice = 777;
  assert.equal(detail.createModel(data, 'a').salesResult, 100);
  assert.deepEqual(original.sales, data.sales); assert.deepEqual(original.payments, data.payments);
});
test('historical value uses quantity on each date, never today’s remaining balance', () => {
  const data = fixture(), value = detail.createModel(data, 'a', { today: '2026-10-19' });
  assert.deepEqual(detail.chartSeries(data, value, { mode: 'value' }).map(point => point.value), [1000,600,1800]);
  assert.deepEqual(detail.chartSeries(data, value, { mode: 'price', from: '2026-02-01', to: '2026-02-28' }).map(point => point.value), [120]);
  assert.deepEqual(detail.chartSeries(data, value, { from: '2027-01-01' }), []);
  data.priceHistory[0].recordedAt = '2026-08-01T12:00:00Z';
  assert.deepEqual(detail.createModel(data, 'a').history.map(point => point.date), ['2026-01-15','2026-02-15','2026-03-15'], 'Delayed import must not reorder the quote dates.');
});
test('same-day operations preserve journal order and unlinked legacy records are not fabricated', () => {
  const data = fixture(); data.transactions[0].date = '2026-02-01'; data.transactions[2].date = '2026-02-01';
  const result = detail.createModel(data, 'a');
  assert.deepEqual(result.operations.filter(tx => tx.date === '2026-02-01').map(tx => tx.id), ['buy-1','sell','buy-2']);
  assert.equal(result.received.find(payment => payment.id === 'div').receivedDate, undefined);
  assert.equal(detail.paymentDate(result.received.find(payment => payment.id === 'div')), null);
});
test('closed and redeemed positions retain historical profit without treating the historical quote as current value', () => {
  const data = fixture(); data.assets[0].closedAt = '2026-04-01T12:00:00Z';
  data.payments.push({ id: 'm', assetId: 'a', type: 'MATURITY', amount: 1550, costBasis: 1500, date: '2026-04-01', receivedDate: '2026-04-02', status: 'paid', currency: 'USD' });
  const value = detail.createModel(data, 'a');
  assert.equal(value.status, 'Redeemed'); assert.equal(value.marketValue, 0); assert.equal(value.unrealized, 0);
  assert.equal(value.receivedAmount, 1600); assert.equal(value.receivedIncome, 100); assert.equal(value.realized, 200);
  assert.equal(value.actions.buy, false); assert.equal(value.actions.sell, false); assert.equal(value.closedDate, '2026-04-01');
});
test('unknown prices, missing cost/history, invalid quotes and type-specific restrictions remain explicit', () => {
  const data = model.createEmptyState(); data.assets.push({ id: 'a', name: 'Legacy', type: 'deposit', quantity: 10, currency: 'UAH', earlyWithdrawal: false, annualRate: 12 });
  data.priceHistory.push({ assetId: 'a', date: '2026-01-01', price: 5 }, { assetId: 'a', date: '2026-02-01', price: 6 },
    { assetId: 'a', date: '2026-02-31', price: 99 }, { assetId: 'a', date: '2026-01-02', price: false });
  const value = detail.createModel(data, 'a');
  assert.equal(value.price, null); assert.equal(value.marketValue, null); assert.equal(value.costBasis, null); assert.equal(value.unrealized, null);
  assert.equal(value.actions.sell, false); assert.equal(value.actions.buy, true); assert.equal(value.history.length, 2);
  assert.ok(value.details.some(([label, amount]) => label === 'Early withdrawal' && amount === false));
  assert.ok(!value.details.some(([label]) => label === 'Ticker' || label === 'ISIN'));
  assert.ok(detail.chartSeries(data, value, { mode: 'value' }).every(point => point.value === null));
  assert.equal(detail.createModel(data, 'missing'), null);
});

test('settled automatic dividend placeholders are absent from planned payments while genuine small payments remain', () => {
  const data = fixture();
  data.payments.push({ id: 'settled', assetId: 'a', type: 'DIVIDEND', date: '2026-09-10', amount: 0, amountPerUnit: 0.01 },
    { id: 'small', assetId: 'a', type: 'DIVIDEND', date: '2026-11-10', amount: 0.06, amountPerUnit: 0.006 });
  const value = detail.createModel(data, 'a');
  assert.equal(value.planned.some(payment => payment.id === 'settled'), false);
  assert.equal(value.planned.some(payment => payment.id === 'small'), true);
});

test('all asset types stack repeated purchases in one read model without modifying their records', () => {
  for (const type of constants.ASSET_TYPES) {
    const data = model.createEmptyState();
    data.assets = ['one','two'].map((id, index) => ({ id, type, name: index ? '  Stacked Asset  ' : 'Stacked Asset', quantity: 10, purchasePrice: 100, currentPrice: 120, currency: 'UAH', annualRate: 0, purchaseDate: '2026-01-0' + (index + 1) }));
    data.transactions = data.assets.map((asset, index) => ({ id: 'buy-' + index, assetId: asset.id, type: 'BUY', quantity: 10, amount: 1000, date: asset.purchaseDate }));
    const original = clone(data), value = detail.createGroupModel(data, 'one', { today: '2026-01-03' });
    assert.equal(value.ids.length, 2, type); assert.equal(value.holding.remainingQuantity, 20, type);
    assert.equal(value.costBasis, 2000, type); assert.equal(value.marketValue, 2400, type);
    assert.equal(value.unrealized, 400, type); assert.equal(value.operations.length, 2, type);
    assert.deepEqual(data, original, type + ': grouping must not merge persisted positions.');
  }
});

test('stacked cards retain closed-lot sales, historical order, received payouts and weighted remaining cost', () => {
  const data = fixture(); data.assets[1].name = data.assets[0].name;
  const original = clone(data), value = detail.createGroupModel(data, ['a'], { today: '2026-10-19' });
  assert.equal(value.ids.length, 2); assert.equal(value.holding.remainingQuantity, 28);
  assert.equal(value.costBasis, 3300); assert.equal(value.salesResult, 1100);
  assert.equal(value.realized, 1150); assert.equal(value.marketValue, null, 'An unknown component price must not become zero.');
  assert.equal(value.operations.filter(operation => operation.type === 'SELL').length, 2);
  data.assets[1].closedAt = '2026-02-02T00:00:00Z';
  const closedLot = detail.createGroupModel(data, 'a');
  assert.equal(closedLot.holding.remainingQuantity, 10); assert.equal(closedLot.costBasis, 1500);
  assert.equal(closedLot.marketValue, 1800); assert.equal(closedLot.salesResult, 1100);
  assert.deepEqual(data.payments, original.payments); assert.deepEqual(data.sales, original.sales);
});

test('stacked payouts aggregate only matching events and preserve every original receipt ID', () => {
  const data = fixture(); data.assets[1].name = data.assets[0].name;
  data.payments.push({ ...data.payments[0], id: 'p-b', assetId: 'b', amount: 70 },
    { ...data.payments[2], id: 'next-b', assetId: 'b', amount: 100 });
  const value = detail.createGroupModel(data, 'a');
  const received = value.received.find(payment => payment.type === 'COUPON');
  assert.equal(received.amount, 100); assert.deepEqual(received.paymentIds, ['p','p-b']);
  assert.equal(value.receivedAmount, 120);
  assert.equal(value.planned[0].amount, 600); assert.deepEqual(value.planned[0].paymentIds, ['next','next-b']);
});

test('stacked history values each lot using its quantity and quote on that date; currency conversion is explicit', () => {
  const data = fixture(); data.assets[1] = { ...data.assets[0], id: 'b', quantity: 5, purchasePrice: 50, currentPrice: 60, currency: 'UAH', purchaseDate: '2026-02-01' };
  data.sales = data.sales.filter(sale => sale.assetId === 'a');
  data.transactions.push({ id: 'b-buy', assetId: 'b', type: 'BUY', date: '2026-02-01', quantity: 5, amount: 250 });
  data.priceHistory.push({ id: 'b-price', assetId: 'b', date: '2026-02-15', price: 60, currency: 'UAH' });
  const value = detail.createGroupModel(data, 'a', { convert: (amount, from, to) => from === 'UAH' && to === 'USD' ? amount / 10 : null });
  assert.equal(value.currency, 'USD'); assert.equal(value.costBasis, 1525); assert.equal(value.marketValue, 1830);
  assert.deepEqual(detail.chartSeries(data, value, { mode: 'value' }).map(point => point.value), [1000,630,1830]);
  assert.equal(detail.createGroupModel(data, 'a').costBasis, null, 'Mixed currencies must not be added without a converter.');
});
