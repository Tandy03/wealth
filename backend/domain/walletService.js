const { runMutation } = require('./mutation');
const { normalizeWallet } = require('../validators/requests');
const { createId } = require('../utils/values');
function createService(repository) {
  const readData = require('./readState').createStateReader(repository);
  async function saveWallet(wallet) {
    const normalized = normalizeWallet(wallet, createId);
    const data = await readData(); data.wallet = normalized;
    await repository.saveData(data); return data.wallet;
  }
  return { saveWallet: wallet => runMutation(repository, () => saveWallet(wallet)) };
}
module.exports = { createService };
