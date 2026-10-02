const { BASE_CURRENCY, normalizeNumber, createId } = require("../utils/values");
const { isValidDateString } = require("../validators");
const { DomainError } = require("../utils/domainError");
const { validateWallet } = require('../validators/requests');
function createService(repository) {
    const { saveData } = repository;
    const readData = require('./readState').createStateReader(repository);
    async function saveWallet(wallet = {}) {
        validateWallet(wallet);
        const data = await readData();
        if (!Array.isArray(wallet.expenses) || !wallet.months || typeof wallet.months !== "object") {
            throw new DomainError({ error: "Invalid wallet data." }, 400);
        }
        wallet.expenses = wallet.expenses.map((expense) => ({
            id: expense.id || createId("expense"),
            createdAt: expense.createdAt || new Date().toISOString(),
            date: expense.date,
            category: String(expense.category || "").trim(),
            amount: normalizeNumber(expense.amount),
            note: String(expense.note || "").trim(),
            currency: BASE_CURRENCY,
        })).filter((expense) => isValidDateString(expense.date) && expense.category && expense.amount > 0);
        data.wallet = wallet;
        await saveData(data);
        return data.wallet;
    }
    return { saveWallet: (...args) => repository.runMutation(() => saveWallet(...args)) };
}
module.exports = { createService };
