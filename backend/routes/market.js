const { Router } = require('express');
const { externalFailure } = require('../utils/apiError');
function createRouter(service) {
    const router = Router();
    const unavailable = 'The external provider is unavailable. Try again later.';
    const endpoints = [
        ['/api/exchange-rates', 'getExchangeRates', { message: 'Could not load exchange rates from the NBU.' }],
        ['/api/market-data/time-series', 'getTimeSeries', { message: unavailable, code: 'TWELVE_DATA_ERROR' }],
        ['/api/market-data/currencies', 'getCurrencies', { message: 'Could not load the NBU currency list.' }],
        ['/api/market-data/currency-history', 'getCurrencyHistory', { message: unavailable }],
        ['/api/market-data/frankfurter-history', 'getFrankfurterHistory', { message: unavailable }],
        ['/api/market-data/index-history', 'getIndexHistory', { message: unavailable, code: 'FRED_API_ERROR' }],
        ['/api/macroeconomics', 'getMacroeconomics', { message: 'Could not load macroeconomic data.', status: 502 }],
        ['/api/macroeconomics/policy-rate', 'getPolicyRate', { message: 'Could not load the NBU key policy rate.', status: 502 }],
        ['/api/inzhur-assets', 'getInzhurAssets', { message: 'Could not load the Inzhur asset catalog.' }],
    ];
    for (const [path, method, failure] of endpoints) router.get(path, async (req, res) => {
        try { res.json(await service[method](req.query)); }
        catch (error) { throw externalFailure(error, failure); }
    });
    return router;
}
module.exports = { createRouter };
