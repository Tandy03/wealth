const { normalizeData } = require('./state');
// Recalculation belongs to the domain, never to physical JSON persistence.
function createStateReader(repository) {
  return async () => normalizeData(await repository.readData());
}
module.exports = { createStateReader };
