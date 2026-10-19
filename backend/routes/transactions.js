const { Router } = require("express");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/transactions", async (req, res) => {
        const result = await service.getTransactions();
        res.status(200).json(result);
    });
    router.post("/api/transactions", async (req, res) => {
        const result = await service.createTransaction(req.body);
        res.status(201).json(result);
    });
    return router;
}
module.exports = { createRouter };
