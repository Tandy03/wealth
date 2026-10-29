const rules = require('../../shared/portfolio-rules');
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
function getAvailableQuantity(data, assetId) { return rules.quantityOnDate(data, assetId); }
function getPurchasedQuantityOnDate(data, assetId, targetDate) { return rules.holdingsAtDate(data, assetId, targetDate).purchasedQuantity; }
function getDividendEligibleQuantity(data, assetId, paymentDate, recordDate) { const asset = data.assets.find(item => item.id === assetId); return asset ? rules.quantityOnDate(data, asset, rules.dividendRecordDate(asset, { date: paymentDate, recordDate })) : 0; }
function repairLegacyPurchaseHistory(data) {
    return rules.repairLegacyPurchaseHistory(data);
}
function updatePlannedPaymentsForAsset(data, assetId) { return rules.refreshPayments(data, assetId); }
function hasReceivedPayment(data, assetId, type, date) {
    return data.payments.some((payment) => payment.assetId === assetId && payment.type === type && payment.date === date &&
        (payment.status === "received" || payment.status === "paid"));
}
module.exports = { normalizeAssetNames, recordAssetPrice, initializeAssetPriceHistory, getSoldQuantity, getAvailableQuantity, getPurchasedQuantityOnDate, getDividendEligibleQuantity, repairLegacyPurchaseHistory, updatePlannedPaymentsForAsset, hasReceivedPayment };
