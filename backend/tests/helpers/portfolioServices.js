// Test fixture composition for scenarios crossing several use cases.
// Production injects each service directly into its router.
function createServices(repository, market = {}) {
  return {
    ...require('../../domain/assetService').createService(repository),
    ...require('../../domain/purchaseService').createService(repository),
    ...require('../../domain/saleService').createService(repository),
    ...require('../../domain/assetMergeService').createService(repository),
    ...require('../../domain/assetSyncService').createService(repository, market),
  };
}
module.exports = { createServices };
