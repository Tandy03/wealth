const rules = require('../../shared/portfolio-rules');
const { normalizeNumber, createId } = require('../utils/values');
const { DomainError } = require('../utils/domainError');
const { validateRequest } = require('../validators/requests');
const { mutationCommands, commandStorage } = require('./mutation');
function createService(repository) {
    const { readData, saveData } = commandStorage(repository);
    async function mergeAssets(assetIds = [], options = {}) {
        validateRequest('merge', { assetIds });
        const data = await readData();
        const ids = [...new Set(Array.isArray(assetIds) ? assetIds.map(String) : [])];
        const assets = data.assets.filter((asset) => ids.includes(asset.id));
        if (assets.length !== ids.length) throw new DomainError({ error: 'One or more holdings were not found.' }, 404);
        if (assets.length < 2)
            throw new DomainError({ error: "At least two holdings are required to merge." }, 400);
        const identity = rules.identity;
        if (new Set(assets.map(identity)).size !== 1) {
            throw new DomainError({ error: "Only the same asset on the same instrument can be merged." }, 400);
        }
        if (assets.some(asset => asset.closedAt || data.payments.some(p => p.assetId === asset.id && p.type === 'MATURITY' && rules.received(p)))) throw new DomainError({ error: 'Closed or redeemed holdings cannot be merged.' }, 400);
        assets.forEach(asset => rules.completeLegacyPurchases(data, asset, createId));
        const primary = assets[0];
        const mergedIds = new Set(assets.slice(1).map((asset) => asset.id));
        const totalQuantity = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity), 0);
        const totalAvailable = assets.reduce((sum, asset) => sum + rules.quantityOnDate(data, asset), 0);
        const totalCurrentValue = assets.reduce((sum, asset) => sum + rules.quantityOnDate(data, asset) * normalizeNumber(asset.currentPrice || asset.purchasePrice), 0);
        primary.quantity = totalQuantity;
        primary.currentPrice = totalAvailable > 0 ? totalCurrentValue / totalAvailable : primary.currentPrice;
        primary.purchaseDate = assets.map((asset) => asset.purchaseDate).filter(Boolean).sort()[0] || primary.purchaseDate;
        primary.firstDividendDate = assets.map((asset) => asset.firstDividendDate).filter(Boolean).sort()[0] || primary.firstDividendDate;
        primary.updatedAt = new Date().toISOString();
        const reassign = (items = []) => items.map((item) => mergedIds.has(item.assetId)
            ? { ...item, assetId: primary.id, assetName: primary.name }
            : item);
        data.transactions = reassign(data.transactions);
        data.sales = reassign(data.sales);
        data.payments = reassign(data.payments);
        data.calendarNotes = reassign(data.calendarNotes);
        data.priceHistory = reassign(data.priceHistory);
        data.assets = data.assets.filter((asset) => !mergedIds.has(asset.id));
        rules.updateHolding(data, primary);
        rules.rebuildPayments(data, primary, createId);
        await saveData(data);
        return primary;
    }
    return { ...mutationCommands(repository, { mergeAssets }) };
}
module.exports = { createService };
