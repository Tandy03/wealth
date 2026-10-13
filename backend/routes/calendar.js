const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/calendar-notes", async (req, res) => {
        try {
            const result = await service.getNotes();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to read calendar notes.",
            });
        }
    });
    router.post("/api/calendar-notes", async (req, res) => {
        try {
            const result = await service.createNote(req.body);
            res.status(201).json(result);
        }
        catch (error) {
            if (error instanceof DomainError || (error.status && error.payload))
                return res.status(error.status).json(error.payload);
            require('../utils/observability').logEvent('request.failed', { code: error.code || 'INTERNAL_ERROR' });
            res.status(500).json({
                error: "Failed to create calendar note.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
