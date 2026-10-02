const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.put("/api/wallet", async (req, res) => {
        try {
            const result = await service.saveWallet(req.body);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("PUT /api/wallet:", error);
            res.status(500).json({ error: "Failed to save wallet." });
        }
    });
    return router;
}
module.exports = { createRouter };
