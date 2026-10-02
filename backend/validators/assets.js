const { DomainError } = require("../utils/domainError");
const { isValidDateString, isValidQuantity, supportsFractionalQuantity } = require("./index");
const { ASSET_TYPES } = require('../config/constants');
function validatePurchase({ quantity, type, purchasePrice, purchaseDate }) {
    if (!isValidQuantity(quantity, type)) {
        throw new DomainError({
            error: supportsFractionalQuantity(type) ? "Quantity must be greater than zero." : "Quantity must be a whole number greater than zero.",
        }, 400);
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        throw new DomainError({
            error: "Purchase price cannot be negative.",
        }, 400);
    }
    if (!isValidDateString(purchaseDate)) {
        throw new DomainError({
            error: "Valid purchase date is required.",
        }, 400);
    }
}
function validateAssetBasics({ name, type, quantity, purchasePrice, purchaseDate }) {
    if (!name) {
        throw new DomainError({
            error: "Asset name is required.",
        }, 400);
    }
    const allowedTypes = ASSET_TYPES;
    if (!allowedTypes.includes(type)) {
        throw new DomainError({
            error: "Invalid asset type.",
        }, 400);
    }
    validatePurchase({ quantity, type, purchasePrice, purchaseDate });
}
module.exports = { validateAssetBasics, validatePurchase };
