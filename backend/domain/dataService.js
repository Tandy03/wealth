function createService(repository) {
    const readData = require('./readState').createStateReader(repository);
    async function getData({ sync = false } = {}) {
        if (sync) await repository.waitForRemoteInitialization?.();
        const data = await readData();
        return data;
    }
    return { getData };
}
module.exports = { createService };
