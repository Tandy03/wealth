const rules = require('../../shared/portfolio-rules');
const { normalizeNumber, createId } = require('../utils/values');
const { validatePurchase } = require('../validators/assets');
const { DomainError } = require('../utils/domainError');
const { validateRequest, validateAssetCurrency, normalizePurchase } = require('../validators/requests');
const { mutationCommands, commandStorage } = require('./mutation');
function createService(repository) {
    const { readData, saveData } = commandStorage(repository);
    async function buyMoreAsset(assetId, body = {}) {
        body = normalizePurchase(body);
        validateRequest('buy', body);
        const data = await readData();
        const asset = data.assets.find((item) => item.id === assetId);
        if (!asset) {
            throw new DomainError({
                error: "Asset not found.",
            }, 404);
        }
        const quantity = normalizeNumber(body.quantity);
        const purchasePrice = normalizeNumber(body.purchasePrice);
        const purchaseDate = body.purchaseDate;
        validatePurchase({ quantity, type: asset.type, purchasePrice, purchaseDate });
        validateAssetCurrency(body, asset);
        const oldQuantity = normalizeNumber(asset.quantity);
        const newCost = quantity * purchasePrice;
        asset.quantity = oldQuantity + quantity;
        asset.updatedAt = new Date().toISOString();
        const transaction = {
            id: createId("tx"),
            createdAt: new Date().toISOString(),
            date: purchaseDate,
            assetId: asset.id,
            assetName: asset.name,
            instrumentId: body.instrumentId || asset.instrumentId,
            type: "BUY",
            quantity,
            /*
             * Price of THIS purchase.
             *
             * This is important because
             * asset.purchasePrice is the
             * average price.
             */
            purchasePrice,
            amount: newCost,
            currency: asset.currency,
        };
        data.transactions.push(transaction);
        rules.updateHolding(data, asset);
        rules.rebuildPayments(data, asset, createId);
        await saveData(data);
        return {
            asset,
            transaction,
        };
    }
    return { ...mutationCommands(repository, { buyMoreAsset }) };
}
module.exports = { createService };
