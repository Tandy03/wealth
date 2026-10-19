(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../../shared/validation').createDefault() : root.FinoValidation,
    typeof module === 'object' && module.exports ? require('../../../shared/errors') : root.FinoErrors, typeof module === 'object' && module.exports ? require('../../../shared/operations') : root.FinoOperations);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoDesktopApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (validation, errors, operations) {
  function createService({ request }) {
    const get = (url, message, params) => {
      try { if (params) params = validation.queryParameters(params, url); }
      catch (error) { return Promise.reject(errors.clientError(error)); }
      return request(url + (params ? '?' + new URLSearchParams(params) : ''), { message });
    };
    const write = (url, method, body, message) => request(url, { method, body, message });
    const identified = (id, operation) => {
      try { validation.validateIdentifier(id); return operation(encodeURIComponent(id)); }
      catch (error) { return Promise.reject(errors.clientError(error)); }
    };
    return operations.client({
      getData: (options = {}) => {
        try { validation.validateReadOptions(options); } catch (error) { return Promise.reject(errors.clientError(error)); }
        return get('/api/data', 'Failed to load data.', options.sync ? { sync: 'true' } : undefined);
      },
      getExchangeRates: () => get('/api/exchange-rates', 'Failed to load NBU exchange rates.'),
      getMarketTimeSeries: params => get('/api/market-data/time-series', 'Failed to load market prices.', params),
      getMarketCurrencies: () => get('/api/market-data/currencies', 'Failed to load NBU currencies.'),
      getCurrencyHistory: params => get('/api/market-data/currency-history', 'Failed to load NBU currency history.', params),
      getFrankfurterHistory: params => get('/api/market-data/frankfurter-history', 'Failed to load Frankfurter exchange-rate history.', params),
      getIndexHistory: params => get('/api/market-data/index-history', 'Failed to load index history from FRED.', params),
      getMacroeconomics: () => get('/api/macroeconomics', 'Failed to load macroeconomic data.'),
      getNbuPolicyRate: () => get('/api/macroeconomics/policy-rate', 'Failed to load the NBU key policy rate.'),
      getGoogleDriveStatus: () => get('/api/sync/status', 'Failed to load Google Drive status.'),
      syncGoogleDrive: (action = 'sync') => write('/api/sync/google-drive', 'POST', { action }, 'Google Drive operation failed.'),
      getInzhurAssets: () => get('/api/inzhur-assets', 'Failed to load the Inzhur catalog.'),
      syncInzhurAssets: () => write('/api/assets/sync-inzhur', 'POST', undefined, 'Failed to synchronize Inzhur assets.'),
      createAsset: asset => write('/api/assets', 'POST', asset, 'Failed to create asset.'),
      updateAsset: (id, asset) => identified(id, key => write('/api/assets/' + key, 'PUT', asset, 'Failed to update asset.')),
      mergeAssets: (assetIds, options = {}) => write('/api/assets/merge', 'POST', { assetIds, operationId: options.operationId }, 'Failed to merge duplicate holdings.'),
      buyMoreAsset: (id, purchase) => identified(id, key => write('/api/assets/' + key + '/buy', 'POST', purchase, 'Failed to buy more asset.')),
      deleteAsset: id => identified(id, key => write('/api/assets/' + key, 'DELETE', undefined, 'Failed to delete asset.')),
      getSales: () => get('/api/sales', 'Failed to load sales.'),
      createSale: sale => write('/api/sales', 'POST', sale, 'Failed to create sale.'),
      getTransactions: () => get('/api/transactions', 'Failed to load transactions.'),
      createTransaction: body => write('/api/transactions', 'POST', body, 'Failed to create transaction.'),
      getPayments: () => get('/api/payments', 'Failed to load payments.'),
      createPayment: body => write('/api/payments', 'POST', body, 'Failed to create payment.'),
      markPaymentReceived: (id, options) => identified(id, key => write('/api/payments/' + key + '/received', 'PATCH', options, 'Failed to mark payment as received.')),
      getCalendarNotes: () => get('/api/calendar-notes', 'Failed to load calendar notes.'),
      createCalendarNote: note => write('/api/calendar-notes', 'POST', note, 'Failed to create calendar note.'),
      saveWallet: wallet => write('/api/wallet', 'PUT', wallet, 'Failed to save wallet.'),
      saveRebalance: body => request('/api/rebalance', { method: 'PUT', body, keepalive: true, message: 'Could not save the rebalance plan. Try again.' }),
    });
  }
  return { createService };
});
