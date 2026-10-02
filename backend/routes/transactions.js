const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/transactions", async (req, res) => {
        try {
            const result = await service.getTransactions();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/transactions:", error);
            res.status(500).json({
                error: "Failed to read transactions.",
            });
        }
    });
    router.post("/api/transactions", async (req, res) => {
        try {
            const result = await service.createTransaction(req.body);
            res.status(201).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("POST /api/transactions:", error);
            res.status(500).json({
                error: "Failed to create transaction.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
