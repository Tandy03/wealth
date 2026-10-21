const { Router } = require("express");
function createRouter(service, repository) {
    const router = Router();
    const transfer = require('../domain/portfolioTransferService').createService(repository);
    router.get('/api/portfolio/export', async (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.status(200).json(await transfer.exportPortfolio());
    });
    router.post('/api/portfolio/import/preview', async (req, res) => {
        res.status(200).json(await transfer.previewPortfolioImport(req.body?.backup));
    });
    router.post('/api/portfolio/import', async (req, res) => {
        res.status(200).json(await transfer.restorePortfolio(req.body));
    });
    router.get("/api/data", async (req, res) => {
        const result = await service.getData({ sync: req.query.sync === 'true' });
        res.status(200).json(result);
    });
    return router;
}
module.exports = { createRouter };
