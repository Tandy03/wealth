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
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("GET /api/calendar-notes:", error);
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
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("POST /api/calendar-notes:", error);
            res.status(500).json({
                error: "Failed to create calendar note.",
            });
        }
    });
    return router;
}
module.exports = { createRouter };
