const { Router } = require("express");
function createRouter(service) {
    const router = Router();
    router.get("/api/sales", async (req, res) => {
        const result = await service.getSales();
        res.status(200).json(result);
    });
    router.post("/api/sales", async (req, res) => {
        const result = await service.sellAsset(req.body);
        res.status(201).json(result);
    });
    return router;
}
module.exports = { createRouter };
