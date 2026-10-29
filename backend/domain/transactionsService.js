const { mutationCommands, commandStorage } = require('./mutation');
const { createTransaction: validateTransaction } = require("../validators/operations");
function createService(repository) {
    const { readData, saveData } = commandStorage(repository);
    async function getTransactions() {
        const data = await readData();
        return data.transactions;
    }
    async function createTransaction(body) {
        const data = await readData();
        const transaction = validateTransaction(data, body);
        const rules = require('../../shared/portfolio-rules');
        rules.recordTransaction(data, data.assets.find(asset => asset.id === transaction.assetId), transaction, require('../utils/values').createId);
        await saveData(data);
        return transaction;
    }
    return { getTransactions, ...mutationCommands(repository, { createTransaction }) };
}
module.exports = { createService };
