const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/sales", async (req, res) => {
        try {
            const result = await service.getSales();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/sales:", error);
            res.status(500).json({
                error: "Failed to read sales.",
            });
        }
    });
    router.post("/api/sales", async (req, res) => {
        try {
            const result = await service.sellAsset(req.body);
            res.status(201).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("POST /api/sales:", error);
            res.status(500).json({
                error: "Failed to create sale.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
