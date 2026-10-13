const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/payments", async (req, res) => {
        try {
            const result = await service.getPayments();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to read payments.",
            });
        }
    });
    router.post("/api/payments", async (req, res) => {
        try {
            const result = await service.createPayment(req.body);
            res.status(201).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to create payment.",
            });
        }
    });
    router.patch("/api/payments/:id/received", async (req, res) => {
        try {
            const result = await service.markPaymentReceived(req.params.id);
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to mark payment as received.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
