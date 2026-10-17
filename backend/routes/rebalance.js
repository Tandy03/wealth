const { Router } = require('express');
function createRouter(service) {
  const router = Router();
  router.put('/api/rebalance', async (req, res, next) => {
    try { res.json(await service.saveRebalance(req.body)); }
    catch (error) { next(error); }
  });
  return router;
}
module.exports = { createRouter };
