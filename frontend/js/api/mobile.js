(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoMobileApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ getAdapter, request }) {
    const methods = ['getData', 'getMarketTimeSeries', 'getMarketCurrencies', 'getCurrencyHistory', 'getFrankfurterHistory', 'getIndexHistory', 'getMacroeconomics', 'getNbuPolicyRate', 'getGoogleDriveStatus', 'syncGoogleDrive', 'createAsset', 'updateAsset', 'mergeAssets', 'buyMoreAsset', 'deleteAsset', 'getSales', 'createSale', 'getTransactions', 'getPayments', 'markPaymentReceived', 'getCalendarNotes', 'createCalendarNote', 'saveWallet'];
    const service = Object.fromEntries(methods.map(method => [method, (...args) => getAdapter()[method](...args)]));
    service.syncInzhurAssets = (...args) => getAdapter().syncApiAssets(...args);
    service.getInzhurAssets = async () => { throw new Error('Inzhur catalog sync requires the desktop backend.'); };
    service.getExchangeRates = async () => {
      const rows = await request('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json', { message: 'Failed to load NBU exchange rates.' });
      const rates = Object.fromEntries(rows.filter(item => ['USD', 'EUR', 'GBP'].includes(item.cc)).map(item => [item.cc, Number(item.rate)]));
      return { rates, exchangeDate: rows[0]?.exchangedate, source: 'NBU' };
    };
    return service;
  }
  function createFacade({ desktop, mobile, isNative }) {
    return Object.fromEntries(Object.keys(desktop).map(method => [method, (...args) => (isNative() ? mobile : desktop)[method](...args)]));
  }
  return { createService, createFacade };
});
