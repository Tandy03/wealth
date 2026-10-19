const rules = require('../../shared/portfolio-rules');
const { normalizeCurrency, normalizeNumber, createId } = require('../utils/values');
const { isValidDateString, supportsFractionalQuantity, isValidQuantity } = require('../validators');
const { DomainError } = require('../utils/domainError');
const { validateRequest, validateAssetCurrency } = require('../validators/requests');
const { QUANTITY_EPSILON } = require('../config/constants');
const { saleFinancials } = require('./calculations');
const { mutationCommands, commandStorage } = require('./mutation');
function createService(repository) {
    const { readData, saveData } = commandStorage(repository);
    async function getSales() {
        const data = await readData();
        return data.sales || [];
    }

    async function sellAsset(body = {}) {
        validateRequest('sale', body);
        const data = await readData();
        const groupedAssetIds = [...new Set(Array.isArray(body?.assetIds) ? body.assetIds.filter(Boolean) : [])];
        if (groupedAssetIds.length) {
            const groupedAssets = data.assets
                .filter((item) => groupedAssetIds.includes(item.id))
                .sort((a, b) => String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || "")));
            if (groupedAssets.length !== groupedAssetIds.length)
                throw new DomainError({ error: "One or more holdings were not found." }, 404);
            const first = groupedAssets[0];
            validateAssetCurrency(body, first);
            if (groupedAssets.some(asset => asset.type === 'novapay' || asset.type === 'deposit' && !asset.earlyWithdrawal))
                throw new DomainError({ error: "This asset cannot be withdrawn before maturity." }, 400);
            const sameHolding = groupedAssets.every((item) => item.type === first.type &&
                String(item.name).trim().toLowerCase() === String(first.name).trim().toLowerCase() &&
                normalizeCurrency(item.currency) === normalizeCurrency(first.currency));
            if (!sameHolding)
                throw new DomainError({ error: "Only matching holdings can be sold together." }, 400);
            const soldQuantity = normalizeNumber(body.quantity);
            const price = normalizeNumber(body.sellPrice);
            const sellDate = body.sellDate;
            if (!isValidQuantity(soldQuantity, first.type))
                throw new DomainError({ error: supportsFractionalQuantity(first.type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero." }, 400);
            if (price < 0)
                throw new DomainError({ error: "Sell price cannot be negative." }, 400);
            if (!isValidDateString(sellDate))
                throw new DomainError({ error: "Valid sell date is required." }, 400);
            const availableQuantity = groupedAssets.reduce((sum, item) => sum + rules.quantityForSale(data, item.id, sellDate), 0);
            if (soldQuantity > availableQuantity + QUANTITY_EPSILON)
                throw new DomainError({ error: `You cannot sell ${soldQuantity} units. Only ${availableQuantity} units are available.` }, 400);
            let remaining = soldQuantity;
            const createdSales = [];
            const createdTransactions = [];
            for (const asset of groupedAssets) {
                if (remaining <= QUANTITY_EPSILON)
                    break;
                const quantity = Math.min(remaining, rules.quantityForSale(data, asset, sellDate));
                if (quantity <= 0)
                    continue;
                const purchasePrice = rules.holdingsAtDate(data, asset, sellDate).averagePrice;
                const { costBasis, saleProceeds, profit, roi } = saleFinancials(quantity, price, purchasePrice);
                const currency = asset.currency || normalizeCurrency(body.currency);
                const createdAt = new Date().toISOString();
                const sale = { id: createId("sale"), costBasisMethod: "moving_average", createdAt, assetId: asset.id, assetName: asset.name, type: asset.type, quantity, sellPrice: price, sellDate, currency, purchasePrice, costBasis, saleProceeds, profit, roi };
                const transaction = { id: createId("tx"), createdAt, date: sellDate, assetId: asset.id, assetName: asset.name, type: "SELL", saleId: sale.id, costBasisMethod: "moving_average", quantity, amount: saleProceeds, currency, costBasis, profit, roi };
                data.sales.push(sale);
                data.transactions.push(transaction);
                rules.updateHolding(data, asset);
                rules.refreshPayments(data, asset.id);
                createdSales.push(sale);
                createdTransactions.push(transaction);
                remaining -= quantity;
            }
            await saveData(data);
            return { sales: createdSales, transactions: createdTransactions, remainingQuantity: availableQuantity - soldQuantity };
        }
        const { assetId, quantity, sellPrice, sellDate, currency } = body || {};
        if (!assetId) {
            throw new DomainError({
                error: "Asset is required.",
            }, 400);
        }
        const soldQuantity = normalizeNumber(quantity);
        const asset = data.assets.find((item) => item.id === assetId);
        if (!asset) {
            throw new DomainError({ error: "Asset not found." }, 404);
        }
        if (asset.type === "novapay" || (asset.type === "deposit" && !asset.earlyWithdrawal)) {
            throw new DomainError({ error: "This asset cannot be withdrawn before maturity." }, 400);
        }
        validateAssetCurrency(body, asset);
        if (!isValidQuantity(soldQuantity, asset.type)) {
            throw new DomainError({
                error: supportsFractionalQuantity(asset.type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero.",
            }, 400);
        }
        const price = normalizeNumber(sellPrice);
        if (price < 0) {
            throw new DomainError({
                error: "Sell price cannot be negative.",
            }, 400);
        }
        if (!isValidDateString(sellDate)) {
            throw new DomainError({
                error: "Valid sell date is required.",
            }, 400);
        }
        const availableQuantity = rules.quantityForSale(data, assetId, sellDate);
        if (soldQuantity > availableQuantity) {
            throw new DomainError({
                error: `You cannot sell ${soldQuantity} units. ` +
                    `Only ${availableQuantity} units are available.`,
            }, 400);
        }
        const purchasePrice = rules.holdingsAtDate(data, asset, sellDate).averagePrice;
        const { costBasis, saleProceeds, profit, roi } = saleFinancials(soldQuantity, price, purchasePrice);
        const saleCurrency = asset.currency || normalizeCurrency(currency);
        const sale = {
            costBasisMethod: "moving_average",
            id: createId("sale"),
            createdAt: new Date().toISOString(),
            assetId: asset.id,
            assetName: asset.name,
            type: asset.type,
            quantity: soldQuantity,
            sellPrice: price,
            sellDate,
            currency: saleCurrency,
            purchasePrice,
            costBasis,
            saleProceeds,
            profit,
            roi,
        };
        data.sales.push(sale);
        const transaction = {
            id: createId("tx"),
            createdAt: new Date().toISOString(),
            date: sellDate,
            assetId: asset.id,
            assetName: asset.name,
            type: "SELL",
            saleId: sale.id,
            costBasisMethod: "moving_average",
            quantity: soldQuantity,
            amount: saleProceeds,
            currency: saleCurrency,
            costBasis,
            profit,
            roi,
        };
        data.transactions.push(transaction);
        rules.updateHolding(data, asset);
        rules.refreshPayments(data, asset.id);
        await saveData(data);
        return {
            sale,
            transaction,
            remainingQuantity: availableQuantity - soldQuantity,
        };
    }
    return { getSales, ...mutationCommands(repository, { sellAsset }) };
}
module.exports = { createService };
