const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/data", async (req, res) => {
        try {
            const result = await service.getData();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/data:", error);
            res.status(500).json({
                error: "Failed to read data.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
