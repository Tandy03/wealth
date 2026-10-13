const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.post("/api/assets/sync-inzhur", async (req, res) => {
        try {
            const result = await service.syncAssets();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(error.status || 502).json({ error: "Could not synchronize assets with Inzhur." });
        }
    });
    router.get("/api/assets", async (req, res) => {
        try {
            const result = await service.getAssets();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to read assets.",
            });
        }
    });
    router.post("/api/assets", async (req, res) => {
        try {
            const result = await service.createAsset(req.body);
            res.status(201).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to create asset.",
            });
        }
    });
    router.post("/api/assets/merge", async (req, res) => {
        try {
            const result = await service.mergeAssets(req.body?.assetIds);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({ error: "Failed to merge duplicate holdings." });
        }
    });
    router.put("/api/assets/:id", async (req, res) => {
        try {
            const result = await service.updateAsset(req.params.id, req.body);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to update asset.",
            });
        }
    });
    router.post("/api/assets/:id/buy", async (req, res) => {
        try {
            const result = await service.buyMoreAsset(req.params.id, req.body);
            res.status(201).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to buy more asset.",
            });
        }
    });
    router.delete("/api/assets/:id", async (req, res) => {
        try {
            const result = await service.deleteAsset(req.params.id);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to delete asset.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
