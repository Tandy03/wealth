const { Router } = require("express");
const { externalFailure } = require('../utils/apiError');
function createRouter({ assets, purchases, merges, sync }) {
    const router = Router();
    router.post("/api/assets/sync-inzhur", async (req, res) => {
        require('../validators/requests').validateRequest('syncAssets', req.body === undefined ? {} : req.body);
        try {
            const result = await sync.syncAssets();
            res.status(200).json(result);
        } catch (error) {
            throw externalFailure(error, { message: "Could not synchronize assets with Inzhur." });
        }
    });
    router.get("/api/assets", async (req, res) => {
        const result = await assets.getAssets();
        res.status(200).json(result);
    });
    router.post("/api/assets", async (req, res) => {
        const result = await assets.createAsset(req.body);
        res.status(201).json(result);
    });
    router.post("/api/assets/merge", async (req, res) => {
        const result = await merges.mergeAssets(req.body?.assetIds, { operationId: req.body?.operationId });
        res.status(200).json(result);
    });
    router.put("/api/assets/:id", async (req, res) => {
        const result = await assets.updateAsset(req.params.id, req.body);
        res.status(200).json(result);
    });
    router.post("/api/assets/:id/buy", async (req, res) => {
        const result = await purchases.buyMoreAsset(req.params.id, req.body);
        res.status(201).json(result);
    });
    router.delete("/api/assets/:id", async (req, res) => {
        const result = await assets.deleteAsset(req.params.id);
        res.status(200).json(result);
    });
    return router;
}
module.exports = { createRouter };
