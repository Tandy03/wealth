function createService(repository) {
    const readData = require('./readState').createStateReader(repository);
    async function getData() {
        const data = await readData();
        return data;
    }
    return { getData };
}
module.exports = { createService };
