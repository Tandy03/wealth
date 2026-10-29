const { Router } = require('express');
function createRouter(service) {
  const router = Router();
  const status = async (_req, res) => res.json(await service.getDriveStatus());
  const sync = async (req, res) => res.json(await service.syncDrive(req.body?.action || req.body?.direction || 'sync', req.body?.previewToken === undefined ? {} : { previewToken: req.body.previewToken }));
  router.get('/api/sync/preview', async (_req, res) => res.json(await service.getConflictPreview()));
  router.get('/api/google-drive/status', status);
  router.get('/api/sync/status', status);
  // External I/O is outside the mutation queue. syncService locks only the final local commit.
  router.post('/api/google-drive/sync', sync);
  router.post('/api/sync/google-drive', sync);
  return router;
}
module.exports = { createRouter };
