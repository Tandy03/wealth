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
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({ error: "Failed to save wallet." });
        }
    });
    return router;
}
module.exports = { createRouter };
