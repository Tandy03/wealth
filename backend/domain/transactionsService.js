const { createTransaction: validateTransaction } = require("../validators/operations");
function createService(repository) {
    const { saveData } = repository;
    const readData = require('./readState').createStateReader(repository);
    async function getTransactions() {
        const data = await readData();
        return data.transactions;
    }
    async function createTransaction(body) {
        const data = await readData();
        const transaction = validateTransaction(data, body);
        data.transactions.push(transaction);
        await saveData(data);
        return transaction;
    }
    return { getTransactions, createTransaction: (...args) => repository.runMutation(() => createTransaction(...args)) };
}
module.exports = { createService };
