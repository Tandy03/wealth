const { Router } = require("express");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/data", async (req, res) => {
        const result = await service.getData({ sync: req.query.sync === 'true' });
        res.status(200).json(result);
    });
    return router;
}
module.exports = { createRouter };
