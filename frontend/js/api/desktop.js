(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoDesktopApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ request }) {
    const get = (url, message, params) => request(url + (params ? '?' + new URLSearchParams(params) : ''), { message });
    const write = (url, method, body, message) => request(url, { method, body, message });
    const assetPath = id => '/api/assets/' + encodeURIComponent(id);
    return {
      getData: () => get('/api/data', 'Failed to load data.'),
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
      updateAsset: (id, asset) => write(assetPath(id), 'PUT', asset, 'Failed to update asset.'),
      mergeAssets: assetIds => write('/api/assets/merge', 'POST', { assetIds }, 'Failed to merge duplicate holdings.'),
      buyMoreAsset: (id, purchase) => write(assetPath(id) + '/buy', 'POST', purchase, 'Failed to buy more asset.'),
      deleteAsset: id => write(assetPath(id), 'DELETE', undefined, 'Failed to delete asset.'),
      getSales: () => get('/api/sales', 'Failed to load sales.'),
      createSale: sale => write('/api/sales', 'POST', sale, 'Failed to create sale.'),
      getTransactions: () => get('/api/transactions', 'Failed to load transactions.'),
      getPayments: () => get('/api/payments', 'Failed to load payments.'),
      markPaymentReceived: id => write('/api/payments/' + encodeURIComponent(id) + '/received', 'PATCH', undefined, 'Failed to mark payment as received.'),
      getCalendarNotes: () => get('/api/calendar-notes', 'Failed to load calendar notes.'),
      createCalendarNote: note => write('/api/calendar-notes', 'POST', note, 'Failed to create calendar note.'),
      saveWallet: wallet => write('/api/wallet', 'PUT', wallet, 'Failed to save wallet.'),
    };
  }
  return { createService };
});
