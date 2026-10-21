const transfer = require('../../shared/portfolio-transfer');
const { runMutation } = require('./mutation');
function createService(repository) {
  return {
    async exportPortfolio() { return transfer.createExport(await repository.readData()); },
    async previewPortfolioImport(backup) {
      await transfer.validateExport(backup);
      return transfer.preview(backup, await repository.readData(), 'desktop');
    },
    async restorePortfolio(body) {
      // The service owns the only mutation queue; the route never wraps it.
      await transfer.validateExport(body?.backup);
      return runMutation(repository, async () => {
        const target = await repository.readData();
        const data = await transfer.restoreInput(body, target, 'desktop');
        data.sync = { revision: Number(target.sync?.revision || 0) + 1, updatedAt: new Date().toISOString(), deviceId: 'manual-restore' };
        const persistence = await repository.writeLocalData(data);
        return { success: true, checksum: await transfer.contentChecksum(data), persistence };
      });
    },
  };
}
module.exports = { createService };
