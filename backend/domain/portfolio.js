const { BASE_CURRENCY, normalizeNumber, createId } = require("../utils/values");
const { DAYS_PER_YEAR, MILLISECONDS_PER_DAY } = require('../config/constants');
function normalizeAssetNames(data) {
    const renamed = new Map();
    (data.assets || []).forEach((asset) => {
        if (String(asset.name || "").trim().toLowerCase() === "ovdp 1") {
            asset.name = "OVDP 5378";
            renamed.set(asset.id, asset.name);
        }
    });
    [data.transactions, data.payments, data.calendarNotes, data.sales, data.priceHistory].forEach((items = []) => {
        items.forEach((item) => { if (renamed.has(item.assetId))
            item.assetName = renamed.get(item.assetId); });
    });
}
function recordAssetPrice(data, asset, source, recordedAt = new Date().toISOString()) {
    const price = normalizeNumber(asset.currentPrice);
    if (price <= 0 || !(data.assets || []).some((item) => item.id === asset.id))
        return;
    data.priceHistory ||= [];
    data.priceHistory.push({
        id: createId("price"), assetId: asset.id, assetName: asset.name,
        recordedAt, date: recordedAt.slice(0, 10), price,
        currency: asset.currency || BASE_CURRENCY, source,
    });
}
function initializeAssetPriceHistory(data) {
    data.priceHistory ||= [];
    (data.assets || []).forEach((asset) => {
        if (normalizeNumber(asset.currentPrice) <= 0)
            return;
        if (data.priceHistory.some((point) => point.assetId === asset.id))
            return;
        recordAssetPrice(data, asset, "initial", asset.lastSyncedAt || asset.updatedAt || asset.createdAt || new Date().toISOString());
    });
}
function getSoldQuantity(data, assetId) {
    return (data.sales || [])
        .filter((sale) => sale.assetId === assetId)
        .reduce((sum, sale) => sum + normalizeNumber(sale.quantity), 0);
}
function getAvailableQuantity(data, assetId) {
    const asset = data.assets.find((item) => item.id === assetId);
    if (!asset) {
        return 0;
    }
    const hasReceivedMaturity = asset.type === "ovdp" &&
        data.payments.some((payment) => payment.assetId === assetId &&
            payment.type === "MATURITY" &&
            (payment.status === "received" || payment.status === "paid"));
    if (asset.closedAt || hasReceivedMaturity) {
        return 0;
    }
    if (asset.type === "crypto_earn") {
        const annualRate = Math.max(0, normalizeNumber(asset.annualRate)) / 100;
        const targetTime = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
        const purchases = (data.transactions || []).filter((transaction) => transaction.assetId === asset.id && transaction.type === "BUY" && transaction.date);
        const sources = purchases.length
            ? purchases.map((transaction) => ({ date: transaction.date, quantity: normalizeNumber(transaction.quantity) }))
            : [{ date: asset.purchaseDate, quantity: normalizeNumber(asset.quantity) }];
        const accrued = sources.reduce((sum, source) => {
            const startTime = new Date(`${source.date}T00:00:00Z`).getTime();
            const days = Number.isFinite(startTime) ? Math.max(0, Math.floor((targetTime - startTime) / MILLISECONDS_PER_DAY)) : 0;
            return sum + source.quantity * ((1 + annualRate / DAYS_PER_YEAR) ** days);
        }, 0);
        const removed = (data.sales || []).filter((sale) => sale.assetId === asset.id && sale.sellDate).reduce((sum, sale) => {
            const soldTime = new Date(`${sale.sellDate}T00:00:00Z`).getTime();
            const days = Number.isFinite(soldTime) ? Math.max(0, Math.floor((targetTime - soldTime) / MILLISECONDS_PER_DAY)) : 0;
            return sum + normalizeNumber(sale.quantity) * ((1 + annualRate / DAYS_PER_YEAR) ** days);
        }, 0);
        return Math.max(0, accrued - removed);
    }
    const originalQuantity = normalizeNumber(asset.quantity);
    const soldQuantity = getSoldQuantity(data, assetId);
    return Math.max(0, originalQuantity - soldQuantity);
}
function getPurchasedQuantityOnDate(data, assetId, targetDate) {
    const target = new Date(`${targetDate}T23:59:59`);
    return (data.transactions || [])
        .filter((transaction) => transaction.assetId === assetId &&
        transaction.type === "BUY" &&
        transaction.date &&
        new Date(`${transaction.date}T00:00:00`) <= target)
        .reduce((sum, transaction) => sum + normalizeNumber(transaction.quantity), 0);
}
function getDividendEligibleQuantity(data, assetId, paymentDate) {
    const payment = new Date(`${paymentDate}T00:00:00`);
    const cutoff = new Date(payment.getFullYear(), payment.getMonth(), 0);
    const purchasedQuantity = getPurchasedQuantityOnDate(data, assetId, `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`);
    const asset = data.assets.find((item) => item.id === assetId);
    return Math.min(purchasedQuantity, normalizeNumber(asset?.quantity));
}
function repairLegacyPurchaseHistory(data) {
    (data.assets || []).forEach((asset) => {
        const buys = (data.transactions || []).filter((transaction) => transaction.assetId === asset.id && transaction.type === "BUY");
        const excess = buys.reduce((sum, transaction) => sum + normalizeNumber(transaction.quantity), 0)
            - normalizeNumber(asset.quantity);
        if (excess <= 1e-8 || !buys.length)
            return;
        const earliest = [...buys].sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)))[0];
        const correctedQuantity = normalizeNumber(earliest.quantity) - excess;
        if (correctedQuantity <= 0)
            return;
        const otherCost = buys.filter((transaction) => transaction !== earliest)
            .reduce((sum, transaction) => sum + normalizeNumber(transaction.amount), 0);
        const correctedCost = Math.max(0, normalizeNumber(asset.quantity) * normalizeNumber(asset.purchasePrice) - otherCost);
        earliest.quantity = correctedQuantity;
        earliest.amount = correctedCost;
        earliest.purchasePrice = correctedCost / correctedQuantity;
        delete earliest.price;
    });
}
function updatePlannedPaymentsForAsset(data, assetId) {
    data.payments = data.payments.map((payment) => {
        if (payment.assetId !== assetId) {
            return payment;
        }
        /*
         * Never modify payments that
         * have already been received.
         */
        if (payment.status === "received" || payment.status === "paid") {
            return payment;
        }
        /*
         * Only coupons and dividends
         * depend on the number of units.
         */
        if (payment.type !== "COUPON" && payment.type !== "DIVIDEND") {
            return payment;
        }
        /*
         * Calculate the quantity that
         * existed on THIS payment date.
         *
         * This is important when the asset
         * was purchased in several portions.
         */
        const quantity = payment.type === "DIVIDEND"
            ? getDividendEligibleQuantity(data, assetId, payment.date)
            : getPurchasedQuantityOnDate(data, assetId, payment.date);
        const amountPerUnit = normalizeNumber(payment.amountPerUnit);
        return {
            ...payment,
            amount: amountPerUnit * quantity,
        };
    });
}
function hasReceivedPayment(data, assetId, type, date) {
    return data.payments.some((payment) => payment.assetId === assetId && payment.type === type && payment.date === date &&
        (payment.status === "received" || payment.status === "paid"));
}
module.exports = { normalizeAssetNames, recordAssetPrice, initializeAssetPriceHistory, getSoldQuantity, getAvailableQuantity, getPurchasedQuantityOnDate, getDividendEligibleQuantity, repairLegacyPurchaseHistory, updatePlannedPaymentsForAsset, hasReceivedPayment };
