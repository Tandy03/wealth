const { Router } = require('express');
function createRouter(service) {
  const router = Router();
  router.put('/api/rebalance', async (req, res) => res.json(await service.saveRebalance(req.body)));
  return router;
}
module.exports = { createRouter };
