const { Router } = require("express");
const { DomainError } = require("../utils/domainError");
const { serializeMutation } = require("./mutation");
function createRouter(service, repository) {
    const router = Router();
    router.get("/api/google-drive/status", async (req, res) => {
        try {
            const result = await service.getDriveStatus();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            throw error;
        }
    });
    router.get("/api/sync/status", async (req, res) => {
        try {
            const result = await service.getDriveStatus();
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            throw error;
        }
    });
    router.post("/api/google-drive/sync", serializeMutation(repository, async (req, res) => {
        try {
            const result = await service.syncDrive(req.body?.action || req.body?.direction || "sync");
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("POST /api/sync/google-drive:", error.message);
            res.status(502).json({ error: error.message, status: repository.drive.getStatus() });
        }
    }));
    router.post("/api/sync/google-drive", serializeMutation(repository, async (req, res) => {
        try {
            const result = await service.syncDrive(req.body?.action || req.body?.direction || "sync");
            res.status(200).json(result);
        }
        catch (error) {
            if (error instanceof DomainError)
                return res.status(error.status).json(error.payload);
            console.error("POST /api/sync/google-drive:", error.message);
            res.status(502).json({ error: error.message, status: repository.drive.getStatus() });
        }
    }));
    return router;
}
module.exports = { createRouter };
