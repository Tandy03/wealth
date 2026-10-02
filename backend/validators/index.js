function isValidDateString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}
function supportsFractionalQuantity(type) {
    return require('../config/constants').FRACTIONAL_ASSET_TYPES.includes(type);
}
function isValidQuantity(value, type) {
    return Number.isFinite(value) && value > 0 && (supportsFractionalQuantity(type) || Number.isInteger(value));
}
module.exports = { isValidDateString, isPositiveInteger, supportsFractionalQuantity, isValidQuantity };
