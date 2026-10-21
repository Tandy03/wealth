(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../../shared/market-model') : root.FinoMarketModel,
    typeof module === 'object' && module.exports ? require('../../../shared/errors') : root.FinoErrors,
    typeof module === 'object' && module.exports ? require('../../../shared/validation').createDefault() : root.FinoValidation, typeof module === 'object' && module.exports ? require('../../../shared/operations') : root.FinoOperations);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoMobileApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (marketModel, errors, validation, operations) {
  function createService({ getAdapter, request }) {
    const methods = ['getData', 'getMarketTimeSeries', 'getMarketCurrencies', 'getCurrencyHistory', 'getFrankfurterHistory', 'getIndexHistory', 'getMacroeconomics', 'getNbuPolicyRate', 'getGoogleDriveStatus', 'syncGoogleDrive', 'createAsset', 'updateAsset', 'mergeAssets', 'buyMoreAsset', 'deleteAsset', 'getSales', 'createSale', 'getTransactions', 'createTransaction', 'getPayments', 'createPayment', 'markPaymentReceived', 'getCalendarNotes', 'createCalendarNote', 'saveWallet', 'saveRebalance'];
    const service = Object.fromEntries(methods.map(method => [method, (...args) => getAdapter()[method](...args)]));
    service.getData = (options = {}) => {
      try { validation.validateReadOptions(options); } catch (error) { return Promise.reject(errors.clientError(error)); }
      return getAdapter().getData({ ...options, sync: options.sync ?? false });
    };
    service.getSyncConflictPreview = (...args) => getAdapter().getSyncConflictPreview(...args);
    for (const method of ['exportPortfolio', 'previewPortfolioImport', 'restorePortfolio']) service[method] = (...args) => getAdapter()[method](...args);
    service.syncInzhurAssets = (...args) => getAdapter().syncApiAssets(...args);
    service.getInzhurAssets = async () => { throw errors.clientError(new errors.RemoteUnavailableError({ message: 'Inzhur catalog sync requires the desktop backend.' })); };
    service.getExchangeRates = async () => {
      try {
        const rows = marketModel.nbuRates(await request('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json', { message: 'Failed to load NBU exchange rates.' }));
        const rates = Object.fromEntries(rows.filter(item => ['USD', 'EUR', 'GBP'].includes(item.cc)).map(item => [item.cc, Number(item.rate)]));
        return { rates, exchangeDate: rows[0]?.exchangedate, source: 'NBU' };
      } catch (error) { throw errors.clientError(error, { fallbackCategory: 'remote_unavailable' }); }
    };
    return operations.client(service, () => getAdapter()?.localAccountScope);
  }
  function createFacade({ desktop, mobile, isNative, outbox }) {
    const service = Object.fromEntries(Object.keys(desktop).map(method => [method, (...args) => (isNative() ? mobile : desktop)[method](...args)]));
    return outbox ? outbox.wrap(service) : service;
  }
  return { createService, createFacade };
});
