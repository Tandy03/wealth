const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/data", async (req, res) => {
        try {
            const result = await service.getData({ sync: req.query.sync === 'true' });
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to read data.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
