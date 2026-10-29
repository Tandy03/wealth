const { Router } = require("express");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/payments", async (req, res) => {
        const result = await service.getPayments();
        res.status(200).json(result);
    });
    router.post("/api/payments", async (req, res) => {
        const result = await service.createPayment(req.body);
        res.status(201).json(result);
    });
    router.patch("/api/payments/:id/received", async (req, res) => {
        const result = await service.markPaymentReceived(req.params.id, req.body);
        res.status(200).json(result);
    });
    return router;
}
module.exports = { createRouter };
