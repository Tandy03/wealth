const { runMutation } = require('./mutation');
const model = require('../../shared/state-model');
function createService(repository) {
  return { saveRebalance: request => runMutation(repository, async () => {
    // Saving UI preferences must not recalculate or repair financial records.
    const data = await repository.readData();
    const plan = model.applyRebalance(data, request);
    await repository.saveData(data);
    return plan;
  }) };
}
module.exports = { createService };
