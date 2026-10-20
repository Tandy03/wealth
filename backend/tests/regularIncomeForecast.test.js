const test = require('node:test');
const assert = require('node:assert/strict');
const { reinvestmentForecast } = require('../../frontend/js/analytics/dashboard');
const model = require('../../shared/state-model');
const asOf = '2026-10-20', start = '2025-10-21';
const shift = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const close = (actual, expected) => assert.ok(Math.abs(actual-expected) <= Math.max(1e-7, Math.abs(expected)*1e-10), `${actual} != ${expected}`);
function fixture(purchaseDate = start) {
  const data = model.createEmptyState();
  data.assets.push({ id:'a', name:'Stock', type:'stock', quantity:100, purchasePrice:100, currentPrice:9999, purchaseDate, currency:'UAH' });
  data.transactions.push({ id:'buy', assetId:'a', type:'BUY', quantity:100, amount:10000, date:purchaseDate, currency:'UAH' });
  const market = { rateInfo(currency, date, method) {
    return { rate: ({UAH:1,USD:method==='report-date'?45:40,EUR:method==='report-date'?51:50})[currency] ?? null,
      date, source:currency==='UAH'?'UAH':'NBU', estimated:false, method };
  } };
  return {data,market,run:() => reinvestmentForecast({data,market,asOf})};
}
const income = (id='income', extra={}) => ({id,assetId:'a',type:'DIVIDEND',status:'received',date:'2026-01-01',amount:1200,currency:'UAH',...extra});

test('365-day recorded regular income yields exact capital, annual return and ordered sensitivity scenarios', () => {
  const h=fixture();h.data.payments.push(income());const before=structuredClone(h.data),r=h.run();
  assert.equal(r.reason,undefined);assert.equal(r.firstDate,start);assert.equal(r.lastDate,asOf);assert.equal(r.observationDays,365);
  close(r.income,1200);close(r.averageMonthlyIncome,100);close(r.averageCapital,10000);close(r.currentCapital,10000);close(r.annualYield,0.12);
  close(r.requiredCapital,4500000);close(r.additionalInvestment,4490000);assert.equal(r.preliminary,false);
  assert.deepEqual(r.scenarios.map(s=>s.multiplier),[0.5,1,1.5]);
  assert.ok(r.scenarios[0].requiredCapital>r.scenarios[1].requiredCapital&&r.scenarios[1].requiredCapital>r.scenarios[2].requiredCapital);
  assert.ok(r.scenarios[0].additionalInvestment>r.scenarios[1].additionalInvestment&&r.scenarios[1].additionalInvestment>r.scenarios[2].additionalInvestment);
  assert.deepEqual(h.data,before);
  h.data.assets[0].currentPrice=1;assert.deepEqual(h.run(),r,'market revaluation must never affect the forecast');
});
test('only received regular payments count, on receipt dates, excluding principal, sale profit, savings and non-recurring income', () => {
  const h=fixture();
  for(const [index,status] of ['received','paid','planned','pending','cancelled'].entries()) h.data.payments.push(income('p'+index,{status,amount:10}));
  h.data.payments.push(income('legacy',{status:undefined,received:true,amount:10}),income('outside',{receivedDate:'2025-10-20',amount:900}),
    income('late',{date:'2025-10-01',receivedDate:'2026-01-01',amount:10}),income('future',{receivedDate:'2026-11-01',amount:900}),
    income('once',{recurring:false,amount:999}),income('maturity',{type:'MATURITY',amount:100000,date:asOf}));
  h.data.assets.push({id:'cash',type:'savings',quantity:100,purchaseDate:start,purchasePrice:1});
  h.data.payments.push(income('household',{assetId:'cash',amount:9999}));
  h.data.sales.push({id:'sale',assetId:'a',sellDate:asOf,quantity:1,costBasis:100,saleProceeds:100000,profit:99900});
  const r=h.run();close(r.income,40);assert.equal(r.receipts.length,4);assert.ok(r.receipts.every(p=>p.date>='2025-10-21'&&p.date<=asOf));
});
test('linked mirrors and stable replays count once; independent equal payments and transactions are retained', () => {
  const h=fixture();
  h.data.payments.push(income('p',{amount:10,operationId:'op-1'}),income('replay',{amount:10,operationId:'op-1'}),income('independent',{amount:10,operationId:'op-2'}));
  h.data.transactions.push({...income('mirror',{amount:10,operationId:'op-1'}),status:'completed',paymentId:'p'},
    {...income('other',{amount:10,operationId:'op-3'}),status:'posted'});
  const r=h.run();close(r.income,30);assert.equal(r.receipts.length,3);assert.equal(r.issues.ambiguousReceipts,0);
  h.data.transactions.push({...income('unclear',{amount:10}),status:'completed'});
  const ambiguous=h.run();assert.equal(ambiguous.reason,'data');assert.equal(ambiguous.scenarios.length,0);assert.equal(ambiguous.issues.ambiguousReceipts,1);
});
test('daily capital follows shared cost basis on purchase, partial sale and actual maturity receipt dates', () => {
  const h=fixture();h.data.assets[0].quantity=15;h.data.transactions[0].quantity=10;h.data.transactions[0].amount=1000;
  h.data.transactions.push({id:'more',assetId:'a',type:'BUY',quantity:5,amount:1000,date:shift(start,10)});
  h.data.sales.push({id:'sale',assetId:'a',quantity:5,costBasis:2000/3,sellDate:shift(start,20)});
  h.data.payments.push(income('coupon',{type:'COUPON',amount:100,date:shift(start,15)}),income('maturity',{type:'MATURITY',amount:500000,date:shift(start,25),receivedDate:shift(start,30)}));
  const r=h.run(),at=offset=>r.dailyCapital[offset].capital;
  close(at(0),1000);close(at(9),1000);close(at(10),2000);close(at(19),2000);close(at(20),2000-2000/3);close(at(29),2000-2000/3);close(at(30),0);
  close(r.averageCapital,(1000*10+2000*10+(2000-2000/3)*10)/365);close(r.currentCapital,0);close(r.income,100);
});
test('full sale and explicit closure remove the capital from that day and future/uncompleted BUY never add capital', () => {
  for(const closure of ['sale','closedAt']) {
    const h=fixture();h.data.payments.push(income());
    if(closure==='sale')h.data.sales.push({id:'s',assetId:'a',sellDate:shift(start,100),quantity:100,costBasis:10000});
    else h.data.assets[0].closedAt=shift(start,100);
    for(const status of ['pending','planned','cancelled'])h.data.transactions.push({id:status,assetId:'a',type:'BUY',status,quantity:50,amount:5000,date:start});
    const r=h.run();close(r.dailyCapital[99].capital,10000);close(r.dailyCapital[100].capital,0);close(r.averageCapital,10000*100/365);close(r.currentCapital,0);
  }
  const h=fixture();h.data.assets[0].quantity=150;
  h.data.transactions.push({id:'future',assetId:'a',type:'BUY',quantity:50,amount:5000,date:'2027-01-01'});h.data.payments.push(income());
  close(h.run().averageCapital,10000);
});
test('shorter observed history excludes pre-acquisition days and is explicitly preliminary; under 90 days has no scenarios', () => {
  const h=fixture(shift(asOf,-181));h.data.payments.push(income('p',{date:asOf,amount:600}));const r=h.run();
  assert.equal(r.observationDays,182);assert.equal(r.preliminary,true);assert.equal(r.estimated,true);close(r.averageCapital,10000);close(r.annualYield,600/10000*365/182);
  close(r.requiredCapital,45000*12/r.annualYield);close(r.averageMonthlyIncome,600*365/182/12);
  const young=fixture(shift(asOf,-88));young.data.payments.push(income('p',{date:asOf}));
  assert.equal(young.run().reason,'history');assert.equal(young.run().scenarios.length,0);
});
test('ancient explicitly closed positions with incomplete acquisition history contribute zero capital and do not block the current window', () => {
  const h=fixture();h.data.payments.push(income());
  h.data.assets.push({id:'ancient',type:'stock',quantity:10,purchaseDate:'2020-01-01',purchasePrice:100,closedAt:'2021-01-01'});
  const r=h.run();assert.equal(r.reason,undefined);close(r.averageCapital,10000);assert.equal(r.observationDays,365);
});
test('a long-abandoned portfolio cannot make a new 60-day investment look like a full year of funded history', () => {
  const h=fixture(shift(asOf,-59));h.data.payments.push(income('p',{date:asOf}));
  h.data.assets.push({id:'ancient',type:'stock',quantity:10,purchaseDate:'2020-01-01',purchasePrice:100,closedAt:'2021-01-01'});
  const r=h.run();assert.equal(r.observationDays,365);assert.equal(r.fundedDays,60);assert.equal(r.reason,'history');assert.equal(r.scenarios.length,0);
});
test('82 funded days are reported independently of an unavailable target FX, and do not bypass the 90-day minimum', () => {
  const h=fixture('2026-07-31');h.data.payments.push(income('p',{date:asOf,amount:307.8}));
  const base=h.market.rateInfo;h.market.rateInfo=(...args)=>({...base(...args),...(args[0]==='USD'?{date:null,source:'Fallback',estimated:true}:{})});
  let r=h.run();assert.equal(r.observationDays,82);assert.equal(r.fundedDays,82);assert.equal(r.insufficientHistory,true);assert.equal(r.reason,'data');
  h.market.rateInfo=base;r=h.run();assert.equal(r.reason,'history');assert.equal(r.insufficientHistory,true);assert.equal(r.targetUnavailable,false);assert.equal(r.scenarios.length,0);
});
test('zero, negative or unknown income and incomplete acquisition/sale history never yield invented capital estimates', () => {
  for(const amount of [0,-100]) { const h=fixture();h.data.payments.push(income('p',{amount}));assert.equal(h.run().reason,amount===0?'data':'return');assert.equal(h.run().requiredCapital,null); }
  const unknown=fixture();assert.equal(unknown.run().reason,'income-history');assert.equal(unknown.run().annualYield,null);assert.equal(unknown.run().income,null);
  const gap=fixture();gap.data.transactions=[];gap.data.payments.push(income());assert.equal(gap.run().reason,'data');assert.equal(gap.run().additionalInvestment,null);
  const sale=fixture();sale.data.sales.push({id:'s',assetId:'a',quantity:10,sellDate:start});sale.data.payments.push(income());assert.equal(sale.run().reason,'data');
  const pending=fixture();pending.data.transactions[0].status='pending';pending.data.payments.push(income());assert.equal(pending.run().reason,'data');
});
test('absent confirmed receipts are unavailable, never numeric zero, while capital and target remain independently available', () => {
  const h=fixture();
  h.data.payments.push(income('planned',{status:'planned'}),income('cancelled',{status:'cancelled'}),income('outside',{date:'2025-10-20'}),income('future',{date:'2026-10-21'}));
  const before=structuredClone(h.data),r=h.run();
  assert.equal(r.incomeState,'missing');assert.equal(r.reason,'income-history');
  for(const key of ['income','averageMonthlyIncome','annualYield','requiredCapital','additionalInvestment'])assert.equal(r[key],null,key);
  assert.deepEqual(r.scenarios,[]);close(r.averageCapital,10000);close(r.currentCapital,10000);close(r.targetMonthlyIncome,45000);
  assert.equal(r.capitalComplete,true);assert.equal(r.currentCapitalComplete,true);assert.equal(r.observationDays,365);assert.deepEqual(h.data,before);
});
test('zero or invalid receipts use income quality failure without invalidating an independent capital history', () => {
  for(const extra of [{amount:0},{amount:null},{amount:'not-a-number'},{amount:true},{date:'2026-02-31'}]) {
    const h=fixture();h.data.payments.push(income('bad',extra));const r=h.run();
    assert.equal(r.incomeState,'invalid');assert.equal(r.reason,'data');assert.ok(r.issues.invalidRecords>0);
    for(const key of ['income','averageMonthlyIncome','annualYield','requiredCapital','additionalInvestment'])assert.equal(r[key],null,key);
    assert.deepEqual(r.scenarios,[]);assert.equal(r.capitalComplete,true);assert.equal(r.currentCapitalComplete,true);
    close(r.averageCapital,10000);close(r.currentCapital,10000);close(r.targetMonthlyIncome,45000);
  }
});
test('offsetting confirmed receipts are a zero-total quality case rather than a zero-yield forecast', () => {
  const h=fixture();h.data.payments.push(income('income',{amount:100}),income('correction',{amount:-100}));const r=h.run();
  assert.equal(r.incomeState,'zero-total');assert.equal(r.receipts.length,2);assert.equal(r.reason,'income-zero');assert.equal(r.income,null);assert.equal(r.averageMonthlyIncome,null);assert.equal(r.annualYield,null);
  assert.deepEqual(r.scenarios,[]);assert.equal(r.capitalComplete,true);close(r.averageCapital,10000);
});
test('unknown FX, undated target FX and material fallback prevent normal scenarios; small fallback is explicitly indicative', () => {
  for(const missing of ['history','target']) {
    const h=fixture();h.data.assets[0].currency='USD';h.data.transactions[0].currency='USD';h.data.payments.push(income());const base=h.market.rateInfo;
    h.market.rateInfo=(currency,date,method)=>({...base(currency,date,method),...(currency==='USD'&&(missing==='history'?method==='operation-date':method==='report-date')?{rate:null,date:null,estimated:true}:{})});
    assert.equal(h.run().reason,'data');assert.ok(h.run().issues.missingFx>0);assert.equal(h.run().scenarios.length,0);
  }
  for(const days of [10,60]) {
    const h=fixture();h.data.assets[0].currency='USD';h.data.transactions[0].currency='USD';h.data.payments.push(income());const base=h.market.rateInfo;
    h.market.rateInfo=(currency,date,method)=>({...base(currency,date,method),...(currency==='USD'&&method==='operation-date'&&date<shift(start,days)?{source:'Fallback',date:null,estimated:true}:{})});
    const r=h.run();assert.equal(r.estimated,true);assert.equal(r.reason,days===60?'data':undefined);assert.ok(r.fxUsage.some(fx=>fx.fallback));
  }
  const h=fixture();h.data.payments.push(income());const base=h.market.rateInfo;h.market.rateInfo=(...args)=>({...base(...args),...(args[0]==='USD'?{date:null,estimated:true}:{})});
  assert.equal(h.run().reason,'data');
  h.market.rateInfo=(...args)=>({...base(...args),...(args[0]==='USD'&&args[2]==='report-date'?{date:'2026-01-01',estimated:true}:{})});
  assert.equal(h.run().reason,'data');assert.equal(h.run().targetUnavailable,true);
});
test('multi-currency receipts use actual receipt FX and daily capital uses daily historical FX; current base and target use report FX', () => {
  const h=fixture();h.data.assets[0].currency='USD';h.data.transactions[0].currency='USD';
  const base=h.market.rateInfo;h.market.rateInfo=(currency,date,method)=>({...base(currency,date,method),...(currency==='USD'&&method==='operation-date'?{rate:date<shift(start,100)?40:44}:{})});
  h.data.payments.push(income('p',{currency:'USD',date:shift(start,200),amount:100}),income('euro',{currency:'EUR',date:shift(start,200),amount:100}));
  const r=h.run();close(r.income,9400);close(r.averageCapital,10000*(100*40+265*44)/365);close(r.currentCapital,450000);close(r.targetMonthlyIncome,45000);
  assert.equal(r.receipts.find(receipt=>receipt.currency==='USD').fx.rate,44);assert.equal(r.targetFx.rate,45);assert.ok(r.fxUsage.every(fx=>fx.from&&fx.source));
});
test('already covered target shows zero additional capital and actual observed monthly excess; conservative shortfall remains explicit', () => {
  const h=fixture();h.data.payments.push(income('p',{amount:600000}));const r=h.run();
  close(r.additionalInvestment,0);close(r.observedExcess,5000);close(r.currentMonthlyExcess,5000);
  assert.equal(r.scenarios[0].targetMet,false);close(r.scenarios[0].shortfall,20000);assert.ok(r.scenarios[0].additionalInvestment>0);
  assert.equal(r.scenarios[1].targetMet,true);assert.ok(r.scenarios.every(scenario=>scenario.additionalInvestment>=0));
});
