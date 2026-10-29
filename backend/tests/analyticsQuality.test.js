const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../shared/state-model');
const baseValues = require('../../frontend/js/analytics/values');
const marketModule = require('../../frontend/js/market-data');
const financeModule = require('../../frontend/js/analytics/portfolio-finance');
const cashflowModule = require('../../frontend/js/cashflow');
const dashboard = require('../../frontend/js/analytics/dashboard');
const contract = require('../../shared/state-contract');
function services() {
  const data = model.createEmptyState();
  const state = { data, purchaseExchangeRates: {}, exchangeRateDate: '20.10.2026', exchangeRateSource: 'NBU', rebalanceDrafts: [] };
  const values = { ...baseValues, getDateString: () => '2026-10-20' };
  const market = marketModule.createService({ state, values, exchangeRates: {UAH:1,USD:45,EUR:51}, historicalRates: {USD:40,EUR:50} });
  const finance = financeModule.createService({state,market,values}), cashflow = cashflowModule.createService({state,market,finance,values});
  return { data,state,market,finance,cashflow };
}
const asset = (id='a', extra={}) => ({id,name:id,type:'stock',quantity:1,purchasePrice:100,currentPrice:110,currency:'UAH',purchaseDate:'2025-10-20',priceUpdatedAt:'2026-10-20',...extra});
const buy = (id='buy', extra={}) => ({id,assetId:'a',type:'BUY',quantity:1,amount:100,date:'2025-10-20',currency:'UAH',...extra});

test('period profit is realized-only, uses receipt dates, and never changes with current quotes or open capital', () => {
  const h=services();h.data.assets.push(asset());h.data.transactions.push(buy());
  h.data.payments.push({id:'late',assetId:'a',type:'DIVIDEND',date:'2026-01-01',receivedDate:'2026-03-01',status:'paid',amount:5,currency:'UAH'},
    {id:'legacy',assetId:'a',type:'COUPON',date:'2026-01-02',received:true,amount:3,currency:'UAH'});
  h.data.sales.push({id:'sale',assetId:'a',sellDate:'2026-01-03',quantity:0,costBasis:50,profit:-2,currency:'UAH'});
  const before=structuredClone(h.data), result=h.cashflow.calculateProfit('2026-01-01','2026-01-31');
  assert.equal(result.totalProfit,1);assert.equal(result.dividends,0);assert.equal(result.coupons,3);assert.equal(result.invested,50);assert.equal(result.roi,null);assert.equal(result.priceGrowth,0);
  assert.equal(h.cashflow.summarizeProfit(result).assetRows[0].roi,null);
  assert.deepEqual(h.data,before);
  h.data.assets[0].currentPrice=9999;h.data.assets.push(asset('future',{purchaseDate:'2027-01-01',quantity:1000}));
  assert.deepEqual(h.cashflow.calculateProfit('2026-01-01','2026-01-31'),result);
  assert.equal(h.cashflow.calculateProfit('2026-03-01','2026-03-31').dividends,5);
  assert.equal(h.cashflow.calculateProfit('2026-03-01','2026-01-01').invalidPeriod,true);
});
test('XIRR uses the shared completion contract for every BUY status and excludes future flows', () => {
  for(const status of [undefined,'completed','posted','pending','planned','cancelled']) {
    const h=services();h.data.assets.push(asset());h.data.transactions.push(buy('buy',{status}),buy('future',{date:'2027-01-01',amount:9000}));
    const result=h.cashflow.calculatePortfolioXirrDetails();
    assert.equal(result.cashFlows.filter(x=>x.amount<0).length,contract.isTransactionCompleted({status})?1:0,status);
    assert.ok(result.cashFlows.every(x=>x.date<='2026-10-20'));
    if(!contract.isTransactionCompleted({status}))assert.equal(result.value,null);
  }
});
test('XIRR counts legacy received payments once and ignores planned income and mirrored transaction rows', () => {
  const h=services();h.data.assets.push(asset());h.data.transactions.push(buy());
  h.data.payments.push({id:'p',assetId:'a',type:'DIVIDEND',received:true,date:'2026-01-01',amount:5},
    {id:'p',assetId:'a',type:'DIVIDEND',received:true,date:'2026-01-01',amount:5},
    {id:'planned',assetId:'a',type:'COUPON',status:'planned',date:'2026-01-01',amount:999});
  h.data.transactions.push({id:'mirror',assetId:'a',type:'DIVIDEND',paymentId:'p',date:'2026-01-01',amount:5},
    {id:'planned-mirror',assetId:'a',type:'COUPON',paymentId:'planned',date:'2026-01-01',amount:999});
  const result=h.cashflow.calculatePortfolioXirrDetails();assert.equal(result.flows.filter(x=>x.kind==='DIVIDEND').length,1);assert.equal(result.flows.filter(x=>x.kind==='COUPON').length,0);
  assert.equal(result.cashFlows.filter(x=>x.amount===5).length,1);
});
test('unfinished purchases cannot become legacy holdings alongside a completed BUY', () => {
  for (const status of ['pending', 'planned', 'cancelled']) {
    const h=services(); h.data.assets.push(asset('a',{quantity:1}));
    h.data.transactions.push(buy(),buy('unfinished',{status,amount:500,date:'2026-01-01'}));
    const valuation=h.finance.valuation(),result=h.cashflow.calculatePortfolioXirrDetails(valuation);
    assert.equal(valuation.rows[0].quantity,1,status); assert.equal(valuation.total,110);
    assert.equal(result.cashFlows.filter(row=>row.amount<0).length,1); assert.equal(result.incomplete,false);
    assert.ok(Math.abs(result.value-0.1)<0.0002);
    h.data.assets[0].quantity=2;
    const gap=h.cashflow.calculatePortfolioXirrDetails();
    assert.equal(gap.value,null);assert.equal(gap.missingHistory,1);
    assert.equal(gap.flows.filter(row=>row.kind==='BUY').length,1,'legacy quantity must not fabricate a completed cash flow from the pending order');
  }
});
test('every payment status follows the shared contract and stable operation replays do not erase independent equal receipts', () => {
  for (const status of [undefined,'planned','pending','cancelled','completed','received','paid']) {
    const h=services();h.data.assets.push(asset());h.data.transactions.push(buy());
    h.data.payments.push({id:'p',assetId:'a',type:'DIVIDEND',status,date:'2026-01-01',amount:5});
    assert.equal(h.cashflow.calculatePortfolioXirrDetails().flows.filter(row=>row.kind==='DIVIDEND').length,contract.isPaymentCompleted({status})?1:0,String(status));
  }
  const h=services();h.data.assets.push(asset());h.data.transactions.push(buy());
  const payment={assetId:'a',type:'DIVIDEND',received:true,date:'2026-01-01',amount:5,operationId:'op-1'};
  h.data.payments.push({...payment,id:'first'},{...payment,id:'replayed'},{...payment,id:'independent',operationId:'op-2'});
  assert.equal(h.cashflow.calculatePortfolioXirrDetails().flows.filter(row=>row.kind==='DIVIDEND').length,2);
  assert.equal(h.cashflow.calculateProfit().dividends,10);
});
test('duplicate BUY facts are not invested twice and mirrored sale facts do not duplicate proceeds', () => {
  const h=services();h.data.assets.push(asset());h.data.transactions.push(buy(),buy());
  h.data.sales.push({id:'s',assetId:'a',sellDate:'2026-01-01',quantity:0.5,costBasis:50,saleProceeds:60});
  h.data.transactions.push({id:'mirror-s',assetId:'a',type:'SELL',saleId:'s',date:'2026-01-01',quantity:0.5,amount:60});
  const result=h.cashflow.calculatePortfolioXirrDetails();assert.equal(result.flows.filter(x=>x.kind==='BUY').length,1);assert.equal(result.flows.filter(x=>x.kind==='SELL').length,1);
  assert.equal(result.valuation.rows[0].quantity,0.5);assert.equal(result.valuation.total,55);
});
test('missing quotes make XIRR incomplete; stale/undated quotes and FX fallback are explicitly indicative', () => {
  const h=services();h.data.assets.push(asset('a',{currentPrice:null}));h.data.transactions.push(buy());
  let result=h.cashflow.calculatePortfolioXirrDetails();assert.equal(result.value,null);assert.equal(result.incomplete,true);assert.equal(result.valuation.unpricedCount,1);assert.equal(result.valuation.knownValue,0);
  h.data.assets[0].currentPrice=110;h.data.assets[0].priceUpdatedAt='2026-01-01';
  result=h.cashflow.calculatePortfolioXirrDetails();assert.equal(result.incomplete,false);assert.equal(result.estimated,true);assert.equal(result.valuation.staleCount,1);assert.equal(result.valuation.freshQuoteShare,0);
  delete h.data.assets[0].priceUpdatedAt;result=h.cashflow.calculatePortfolioXirrDetails();assert.equal(result.valuation.undatedCount,1);assert.equal(result.estimated,true);
  h.data.assets[0].currency='USD';h.data.transactions[0].currency='USD';result=h.cashflow.calculatePortfolioXirrDetails();assert.equal(result.estimatedFx,1);assert.equal(result.cashFlows[0].fx.source,'Fallback');
});
test('historical FX never borrows a future rate; report profit and XIRR expose their distinct currency methods', () => {
  const h=services();h.state.purchaseExchangeRates.USD=[{date:'2026-01-01',rate:35},{date:'2026-12-01',rate:90}];
  assert.equal(h.market.rateInfo('USD','2025-12-01','operation-date').rate,40);assert.equal(h.market.rateInfo('USD','2025-12-01','operation-date').estimated,true);
  assert.equal(h.market.rateInfo('USD','2026-01-01','operation-date').rate,35);assert.equal(h.market.rateInfo('USD','2026-01-01','operation-date').estimated,false);
  assert.equal(h.market.rateInfo('GBP','2026-01-01','operation-date').rate,null);
  h.data.assets.push(asset('a',{currency:'USD'}));h.data.transactions.push(buy('buy',{currency:'USD'}));h.data.payments.push({id:'p',assetId:'a',type:'DIVIDEND',status:'received',date:'2026-01-01',amount:5,currency:'USD'});
  const profit=h.cashflow.calculateProfit('2026-01-01','2026-01-31'),xirr=h.cashflow.calculatePortfolioXirrDetails();
  assert.equal(profit.dividends,225);assert.equal(profit.method,'report-date');assert.equal(xirr.cashFlows.find(x=>x.date==='2026-01-01').amount,175);assert.equal(xirr.method,'operation-date');
});
test('malformed historical FX cache falls back explicitly and conversion overflow never masquerades as a valid amount', () => {
  const h=services();
  for (const source of [{rate:99},[null,{date:'2026-02-31',rate:99},{date:'2026-01-01',rate:'invalid'}]]) {
    h.state.purchaseExchangeRates.USD=source;
    const fx=h.market.rateInfo('USD','2026-01-01','operation-date');
    assert.equal(fx.rate,40); assert.equal(fx.estimated,true); assert.equal(fx.date,null);
  }
  assert.equal(h.market.convertWithInfo(1e308,'USD').amount,null);
});
test('report FX uses an available official historical observation instead of labelling undated or next-day live rates as fallback', () => {
  const h=services();h.state.purchaseExchangeRates.USD=[{date:'2026-10-20',rate:45.0802}];
  for (const date of ['21.10.2026',null]) {
    h.state.exchangeRateDate=date;
    const fx=h.market.rateInfo('USD','2026-10-20');
    assert.equal(fx.rate,45.0802);assert.equal(fx.date,'2026-10-20');assert.equal(fx.source,'NBU history');assert.equal(fx.estimated,false);assert.equal(fx.method,'report-date');
  }
  h.state.exchangeRateDate='21.10.2026';h.state.purchaseExchangeRates.USD=[];
  const unavailable=h.market.rateInfo('USD','2026-10-20');
  assert.equal(unavailable.rate,null);assert.equal(unavailable.date,'2026-10-21');assert.equal(unavailable.source,'NBU');
});
test('XIRR uses actual dates with a 365-day annualization and does not accept impossible dates', () => {
  const h=services();assert.ok(Math.abs(h.cashflow.calculateXirr([{date:'2025-01-01',amount:-100},{date:'2026-01-01',amount:110}])-0.1)<0.0002);
  assert.equal(h.cashflow.calculateXirr([{date:'2026-02-31',amount:-100},{date:'2026-10-01',amount:110}]),null);
  const years=(Date.parse('2026-01-01')-Date.parse('1980-01-01'))/31536000000;
  for (const scale of [0.001,1,1e12]) assert.ok(Math.abs(h.cashflow.calculateXirr([{date:'1980-01-01',amount:-100*scale},{date:'2026-01-01',amount:100*scale*1.05**years}])-0.05)<1e-9);
});
test('regular-income forecast cannot be manufactured from aggregate portfolio profit and current capital', () => {
  const result=dashboard.reinvestmentForecast({totalProfit:1200,investedCapital:10000,firstDate:'2025-10-20',usdRate:45});
  assert.equal(result.reason,'data');assert.deepEqual(result.scenarios,[]);
});
test('concentration stacks lots by security, separates unknown metadata and makes excluded quote coverage explicit', () => {
  const h=services();h.data.assets.push(asset('a',{isin:'AA',issuer:'Issuer A',sector:'Technology'}),asset('b',{isin:'AA',currency:'UAH',issuer:'Issuer A',sector:'Technology'}),asset('c',{currentPrice:null,currency:'USD'}));
  h.data.transactions.push(buy(),buy('b',{assetId:'b'}),buy('c',{assetId:'c',currency:'USD'}));
  const before=structuredClone(h.data),v=h.finance.valuation('2026-10-20'),m=h.finance.concentration('market',v),cost=h.finance.concentration('cost',v);
  assert.equal(m.positions.length,1);assert.equal(m.topOneShare,100);assert.equal(m.excludedCount,1);assert.equal(m.issuers[0].label,'Issuer A');
  assert.equal(cost.positions.length,2);assert.equal(cost.excludedCount,0);assert.equal(cost.issuers.find(x=>x.unknown).label,'Unknown');
  assert.equal(cost.currencies.length,2);assert.ok(v.freshQuoteShare<100);assert.deepEqual(h.data,before);
});
