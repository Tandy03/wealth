const { BASE_CURRENCY, normalizeCurrency, normalizeNumber, createId } = require("../utils/values");
const { createPayment: validatePayment } = require("../validators/operations");
const { DomainError } = require("../utils/domainError");
function createService(repository) {
    const { saveData } = repository;
    const readData = require('./readState').createStateReader(repository);
    async function getPayments() {
        const data = await readData();
        return data.payments;
    }
    async function createPayment(body) {
        const data = await readData();
        const payment = validatePayment(data, body);
        data.payments.push(payment);
        await saveData(data);
        return payment;
    }
    async function markPaymentReceived(paymentId) {
        const data = await readData();
        const payment = data.payments.find((item) => item.id === paymentId);
        if (!payment) {
            throw new DomainError({
                error: "Payment not found.",
            }, 404);
        }
        /*
         * Prevent marking an already
         * received payment twice.
         */
        if (payment.status === "received" || payment.status === "paid" || payment.received) {
            return payment;
        }
        /*
         * Mark payment as received.
         */
        if (payment.type === 'MATURITY') payment.costBasis = require('../../frontend/js/portfolio-rules').holdingsAtDate(data, payment.assetId, new Date().toISOString().slice(0, 10)).remainingCost;
        payment.status = "received";
        const receivedNow = new Date();
        payment.receivedAt = receivedNow.toISOString();
        payment.receivedDate = `${receivedNow.getFullYear()}-${String(receivedNow.getMonth() + 1).padStart(2, "0")}-${String(receivedNow.getDate()).padStart(2, "0")}`;
        const asset = data.assets.find((item) => item.id === payment.assetId);
        if (payment.type === "MATURITY" && asset) {
            asset.closedAt = payment.receivedAt;
        }
        data.transactions.push({
            id: createId("tx"),
            createdAt: payment.receivedAt,
            date: payment.receivedDate,
            assetId: payment.assetId,
            assetName: payment.assetName,
            paymentId: payment.id,
            type: payment.type,
            quantity: null,
            amount: payment.amount,
            currency: payment.currency || BASE_CURRENCY,
        });
        /*
         * Save updated data.
         */
        await saveData(data);
        /*
         * Return updated payment.
         */
        return payment;
    }
    return { getPayments, createPayment: (...args) => repository.runMutation(() => createPayment(...args)), markPaymentReceived: (...args) => repository.runMutation(() => markPaymentReceived(...args)) };
}
module.exports = { createService };
