const { Router } = require("express");
function createRouter(service, repository) {
    const router = Router();
    router.put("/api/wallet", async (req, res) => {
        const result = await service.saveWallet(req.body);
        res.status(200).json(result);
    });
    return router;
}
module.exports = { createRouter };
