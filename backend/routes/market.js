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
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/exchange-rates:", error);
            res.status(502).json({ error: "Could not load exchange rates from the NBU." });
        }
    });
    router.get("/api/market-data/time-series", async (req, res) => {
        try {
            const result = await service.getTimeSeries(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/market-data/time-series:", error.code || error.message);
            res.status(error.status || 502).json({ error: error.message, code: error.code || "TWELVE_DATA_ERROR" });
        }
    });
    router.get("/api/market-data/currencies", async (req, res) => {
        try {
            const result = await service.getCurrencies(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/market-data/currencies:", error.message);
            res.status(502).json({ error: "Could not load the NBU currency list." });
        }
    });
    router.get("/api/market-data/currency-history", async (req, res) => {
        try {
            const result = await service.getCurrencyHistory(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/market-data/currency-history:", error.message);
            res.status(error.status || 502).json({ error: error.message });
        }
    });
    router.get("/api/market-data/frankfurter-history", async (req, res) => {
        try {
            const result = await service.getFrankfurterHistory(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/market-data/frankfurter-history:", error.message);
            res.status(error.status || 502).json({ error: error.message });
        }
    });
    router.get("/api/market-data/index-history", async (req, res) => {
        try {
            const result = await service.getIndexHistory(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/market-data/index-history:", error.code || error.message);
            res.status(error.status || 502).json({ error: error.message, code: error.code || "FRED_API_ERROR" });
        }
    });
    router.get("/api/macroeconomics", async (req, res) => {
        try {
            const result = await service.getMacroeconomics(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/macroeconomics:", error.message);
            res.status(502).json({ error: "Could not load macroeconomic data." });
        }
    });
    router.get("/api/macroeconomics/policy-rate", async (req, res) => {
        try {
            const result = await service.getPolicyRate(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/macroeconomics/policy-rate:", error.message);
            res.status(502).json({ error: "Could not load the NBU key policy rate." });
        }
    });
    router.get("/api/inzhur-assets", async (req, res) => {
        try {
            const result = await service.getInzhurAssets(req.query);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/inzhur-assets:", error);
            res.status(502).json({
                error: "Could not load the Inzhur asset catalog.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
