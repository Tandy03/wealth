const { Router } = require("express");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/calendar-notes", async (req, res) => {
        const result = await service.getNotes();
        res.status(200).json(result);
    });
    router.post("/api/calendar-notes", async (req, res) => {
        const result = await service.createNote(req.body);
        res.status(201).json(result);
    });
    return router;
}
module.exports = { createRouter };
