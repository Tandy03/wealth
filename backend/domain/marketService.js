const { normalizeNumber } = require("../utils/values");
const { getTimeSeries } = require("../services/twelveData/client");
const { INZHUR_ASSETS_URL, INZHUR_CACHE_TTL_MS } = require('../config/constants');
const { requestJson } = require('../services/market/request');
function createService(sources = {}) {
    const nbu = sources.nbu || require('../services/market/nbu').createSource();
    const fred = sources.fred || require('../services/market/fred');
    const frankfurter = sources.frankfurter || require('../services/market/frankfurter');
    const macro = sources.macro || require('../services/market/macro');
    let inzhurAssetsCache = {
        updatedAt: 0,
        assets: null,
    };
    async function loadInzhurCatalog() {
        const cacheIsFresh = inzhurAssetsCache.assets &&
            Date.now() - inzhurAssetsCache.updatedAt < INZHUR_CACHE_TTL_MS;
        if (!cacheIsFresh) {
            const payload = await requestJson(INZHUR_ASSETS_URL, {
                headers: { Accept: "application/json" },
            });
            if (!Array.isArray(payload)) {
                throw new Error("Inzhur API returned an invalid payload.");
            }
            inzhurAssetsCache = {
                updatedAt: Date.now(),
                assets: require('../../shared/market-model').inzhurCatalog(payload),
            };
        }
        return { ...inzhurAssetsCache, cached: cacheIsFresh };
    }
    async function getInzhurCatalogAssets() {
        return (await loadInzhurCatalog()).assets;
    }
    async function getExchangeRates() { return nbu.getExchangeRates(); }
    async function getTimeSeriesOperation(query = {}) {
        const result = await getTimeSeries({
            symbol: query.symbol,
            interval: query.interval,
            outputsize: query.outputsize,
            startDate: query.startDate,
            endDate: query.endDate,
        });
        return result;
    }
    async function getCurrencies(query = {}) { return nbu.getCurrencies(query); }
    async function getCurrencyHistory(query = {}) {
        return await nbu.getCurrencyHistory({ code: query.code, startDate: query.startDate, endDate: query.endDate });
    }
    async function getFrankfurterHistory(query = {}) {
        return await frankfurter.getExchangeHistory({ ticker: query.ticker, startDate: query.startDate, endDate: query.endDate });
    }
    async function getIndexHistoryOperation(query = {}) {
        return await fred.getIndexHistory({ symbol: query.symbol, startDate: query.startDate, endDate: query.endDate });
    }
    async function getMacroeconomicsOperation(query = {}) {
        return await macro.getMacroeconomics();
    }
    async function getPolicyRateOperation(query = {}) {
        return { policyRate: await macro.getPolicyRate() };
    }
    async function getInzhurAssets(query = {}) {
        const catalog = await loadInzhurCatalog();
        return {
            updatedAt: new Date(catalog.updatedAt).toISOString(),
            cached: catalog.cached,
            assets: catalog.assets,
        };
    }
    return { getExchangeRates, getTimeSeries: getTimeSeriesOperation, getCurrencies, getCurrencyHistory, getFrankfurterHistory, getIndexHistory: getIndexHistoryOperation, getMacroeconomics: getMacroeconomicsOperation, getPolicyRate: getPolicyRateOperation, getInzhurAssets, getInzhurCatalogAssets };
}
module.exports = { createService };
