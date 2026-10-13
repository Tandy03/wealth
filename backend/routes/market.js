const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/exchange-rates", async (req, res) => {
        try {
            const result = await service.getExchangeRates(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ category: 'remote_unavailable', error: "Could not load exchange rates from the NBU." });
        }
    });
    router.get("/api/market-data/time-series", async (req, res) => {
        try {
            const result = await service.getTimeSeries(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ category: 'remote_unavailable', error: 'The external provider is unavailable. Try again later.', code: error.code || "TWELVE_DATA_ERROR" });
        }
    });
    router.get("/api/market-data/currencies", async (req, res) => {
        try {
            const result = await service.getCurrencies(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ category: 'remote_unavailable', error: "Could not load the NBU currency list." });
        }
    });
    router.get("/api/market-data/currency-history", async (req, res) => {
        try {
            const result = await service.getCurrencyHistory(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ category: 'remote_unavailable', error: 'The external provider is unavailable. Try again later.' });
        }
    });
    router.get("/api/market-data/frankfurter-history", async (req, res) => {
        try {
            const result = await service.getFrankfurterHistory(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ category: 'remote_unavailable', error: 'The external provider is unavailable. Try again later.' });
        }
    });
    router.get("/api/market-data/index-history", async (req, res) => {
        try {
            const result = await service.getIndexHistory(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ category: 'remote_unavailable', error: 'The external provider is unavailable. Try again later.', code: error.code || "FRED_API_ERROR" });
        }
    });
    router.get("/api/macroeconomics", async (req, res) => {
        try {
            const result = await service.getMacroeconomics(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(502).json({ category: 'remote_unavailable', error: "Could not load macroeconomic data." });
        }
    });
    router.get("/api/macroeconomics/policy-rate", async (req, res) => {
        try {
            const result = await service.getPolicyRate(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(502).json({ category: 'remote_unavailable', error: "Could not load the NBU key policy rate." });
        }
    });
    router.get("/api/inzhur-assets", async (req, res) => {
        try {
            const result = await service.getInzhurAssets(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({
                error: "Could not load the Inzhur asset catalog.", category: "remote_unavailable",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
