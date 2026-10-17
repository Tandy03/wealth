const model = require('../../frontend/js/state-model');
function createService(repository) {
  return { saveRebalance: request => repository.runMutation(async () => {
    // Saving UI preferences must not recalculate or repair financial records.
    const data = await repository.readData();
    const plan = model.applyRebalance(data, request);
    await repository.saveData(data);
    return plan;
  }) };
}
module.exports = { createService };
