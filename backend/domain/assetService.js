const rules = require('../../shared/portfolio-rules');
const { normalizeCurrency, normalizeNumber, createId } = require('../utils/values');
const { isValidDateString } = require('../validators');
const { validateAssetBasics } = require('../validators/assets');
const { DomainError } = require('../utils/domainError');
const { recordAssetPrice, getSoldQuantity } = require('./portfolio');
const { validateAssetInput } = require('../validators/requests');
const { DEFAULT_BOND_REDEMPTION } = require('../config/constants');
const { mutationCommands, commandStorage } = require('./mutation');
function createService(repository) {
    const { readData, saveData } = commandStorage(repository);
    async function getAssets() {
        const data = await readData();
        return data.assets;
    }

    async function createAsset(body = {}) {
        validateAssetInput(body);
        const data = await readData();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const type = typeof body.type === "string" ? body.type : "";
        const currency = normalizeCurrency(body.currency);
        const quantity = normalizeNumber(body.quantity);
        const purchasePrice = normalizeNumber(body.purchasePrice);
        const purchaseDate = body.purchaseDate;
        const isin = typeof body.isin === "string" ? body.isin.trim().toUpperCase() : "";
        const currentPrice = normalizeNumber(body.currentPrice);
        validateAssetBasics({ name, type, quantity, purchasePrice, purchaseDate });
        const asset = {
            id: createId("asset"),
            createdAt: new Date().toISOString(),
            name,
            type,
            currency,
            quantity,
            purchasePrice,
            purchaseDate,
            isin: type === "ovdp" ? isin : "",
            currentPrice: ["s1_reit", "etf", "stock", "crypto_earn"].includes(type) && currentPrice > 0 ? currentPrice : undefined,
            instrumentName: typeof body.instrumentName === "string" ? body.instrumentName.trim() : "",
            dividendRecordRule: body.dividendRecordRule || "previous_month_end",
            instrumentType: typeof body.instrumentType === "string" ? body.instrumentType.trim() : "",
        };
        if (type === "inzhur_reit" || type === "s1_reit") {
            const dividendPerUnit = normalizeNumber(body.dividendPerUnit);
            const firstDividendDate = body.firstDividendDate;
            if (dividendPerUnit <= 0) {
                throw new DomainError({
                    error: "Dividend per unit must be greater than zero.",
                }, 400);
            }
            if (!isValidDateString(firstDividendDate)) {
                throw new DomainError({
                    error: "Valid first dividend date is required.",
                }, 400);
            }
            asset.paymentMethod = "monthly_dividend";
            asset.dividendPerUnit = dividendPerUnit;
            asset.firstDividendDate = firstDividendDate;
        }
        if (type === "ovdp") {
            const maturityDate = body.maturityDate;
            if (!isValidDateString(maturityDate)) {
                throw new DomainError({
                    error: "Valid maturity date is required.",
                }, 400);
            }
            if (!Array.isArray(body.coupons) || body.coupons.length === 0) {
                throw new DomainError({
                    error: "At least one coupon is required.",
                }, 400);
            }
            const coupons = body.coupons
                .map((coupon) => ({
                date: coupon.date,
                amountPerUnit: normalizeNumber(coupon.amountPerUnit),
            }))
                .filter((coupon) => isValidDateString(coupon.date) && coupon.amountPerUnit > 0);
            if (!coupons.length) {
                throw new DomainError({
                    error: "No valid coupons were provided.",
                }, 400);
            }
            asset.paymentMethod = "coupons";
            asset.maturityDate = maturityDate;
            asset.coupons = coupons;
            asset.redemptionValue = normalizeNumber(body.redemptionValue) || DEFAULT_BOND_REDEMPTION;
        }
        if (type === "inzhur_miltech") {
            asset.paymentMethod = "capitalization";
        }
        if (type === "etf" || type === "stock") {
            asset.paymentMethod = "capitalization";
            asset.ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
        }
        if (body.isNewInstrument && asset.instrumentName) {
            const exists = data.instruments.some((item) => item.name.toLowerCase() === asset.instrumentName.toLowerCase());
            if (!exists)
                data.instruments.push({ id: createId("instrument"), name: asset.instrumentName, type: asset.instrumentType || "Other" });
        }
        if (type === "savings") {
            asset.paymentMethod = "none";
            asset.currentPrice = purchasePrice;
        }
        if (type === "novapay") {
            const termMonths = Math.min(12, Math.max(1, Math.trunc(normalizeNumber(body.termMonths))));
            const maturityAmount = normalizeNumber(body.maturityAmount);
            const maturityDate = body.maturityDate;
            if (!isValidDateString(maturityDate) || maturityAmount <= 0)
                throw new DomainError({ error: "NovaPay maturity date and payout are required." }, 400);
            Object.assign(asset, { termMonths, maturityDate, maturityAmount, maturityAmountPerUnit: maturityAmount / quantity, paymentMethod: "fixed_maturity", earlyWithdrawal: false });
        }
        if (type === "deposit") {
            const annualRate = normalizeNumber(body.annualRate);
            const maturityDate = body.maturityDate;
            if (!isValidDateString(maturityDate) || annualRate < 0)
                throw new DomainError({ error: "Deposit maturity date and annual rate are required." }, 400);
            Object.assign(asset, { annualRate, maturityDate, earlyWithdrawal: Boolean(body.earlyWithdrawal), paymentMethod: "deposit_interest" });
        }
        if (type === "crypto_earn") {
            const annualRate = normalizeNumber(body.annualRate);
            if (annualRate <= 0)
                throw new DomainError({ error: "Crypto Earn APR must be greater than zero." }, 400);
            Object.assign(asset, {
                ticker: String(body.ticker || name).trim().toUpperCase(),
                annualRate,
                currentPrice: currentPrice > 0 ? currentPrice : purchasePrice,
                paymentMethod: "crypto_earn",
            });
        }
        data.assets.push(asset);
        data.transactions.push({
            id: createId("tx"),
            createdAt: new Date().toISOString(),
            date: purchaseDate,
            assetId: asset.id,
            assetName: asset.name,
            type: "BUY",
            quantity,
            amount: quantity * purchasePrice,
            currency,
        });
        rules.updateHolding(data, asset);
        rules.rebuildPayments(data, asset, createId);
        await saveData(data);
        return asset;
    }

    async function updateAsset(assetId, body = {}) {
        validateAssetInput(body);
        const data = await readData();
        const asset = data.assets.find((item) => item.id === assetId);
        if (!asset) {
            throw new DomainError({
                error: "Asset not found.",
            }, 404);
        }
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const type = typeof body.type === "string" ? body.type : "";
        const currency = normalizeCurrency(body.currency || asset.currency);
        const quantity = normalizeNumber(body.quantity);
        const purchasePrice = normalizeNumber(body.purchasePrice);
        const purchaseDate = body.purchaseDate;
        const isin = typeof body.isin === "string" ? body.isin.trim().toUpperCase() : "";
        const currentPrice = normalizeNumber(body.currentPrice);
        validateAssetBasics({ name, type, quantity, purchasePrice, purchaseDate });
        let paymentMethod;
        let dividendPerUnit;
        let firstDividendDate;
        let maturityDate;
        let coupons = [];
        /*
         * REIT
         */
        if (type === "inzhur_reit" || type === "s1_reit") {
            dividendPerUnit = normalizeNumber(body.dividendPerUnit);
            firstDividendDate = body.firstDividendDate;
            if (dividendPerUnit <= 0) {
                throw new DomainError({
                    error: "Dividend per unit must be greater than zero.",
                }, 400);
            }
            if (!isValidDateString(firstDividendDate)) {
                throw new DomainError({
                    error: "Valid first dividend date is required.",
                }, 400);
            }
            paymentMethod = "monthly_dividend";
        }
        /*
         * OVDP
         */
        if (type === "ovdp") {
            maturityDate = body.maturityDate;
            if (!isValidDateString(maturityDate)) {
                throw new DomainError({
                    error: "Valid maturity date is required.",
                }, 400);
            }
            coupons = Array.isArray(body.coupons)
                ? body.coupons
                    .map((coupon) => ({
                    date: coupon.date,
                    amountPerUnit: normalizeNumber(coupon.amountPerUnit),
                }))
                    .filter((coupon) => isValidDateString(coupon.date) && coupon.amountPerUnit > 0)
                : [];
            if (!coupons.length) {
                throw new DomainError({
                    error: "At least one valid coupon is required.",
                }, 400);
            }
            paymentMethod = "coupons";
        }
        /*
         * MILTECH
         */
        if (type === "inzhur_miltech") {
            paymentMethod = "capitalization";
        }
        if (!rules.canEditPurchase(data, asset, body)) throw new DomainError({ error: 'Purchase history or currency cannot be rewritten after additional purchases or sales. Use buy/sell operations.' }, 400);
        const soldQuantity = getSoldQuantity(data, assetId);
        if (quantity < soldQuantity) {
            throw new DomainError({
                error: `Asset quantity cannot be less than already sold quantity (${soldQuantity}).`,
            }, 400);
        }
        asset.dividendRecordRule = body.dividendRecordRule || asset.dividendRecordRule || "previous_month_end";
        asset.name = name;
        asset.type = type;
        asset.currency = currency;
        asset.quantity = quantity;
        asset.purchasePrice = purchasePrice;
        asset.purchaseDate = purchaseDate;
        asset.instrumentName = typeof body.instrumentName === "string" ? body.instrumentName.trim() : asset.instrumentName || "";
        asset.instrumentType = typeof body.instrumentType === "string" ? body.instrumentType.trim() : asset.instrumentType || "";
        if (body.isNewInstrument && asset.instrumentName) {
            const exists = data.instruments.some((item) => item.name.toLowerCase() === asset.instrumentName.toLowerCase());
            if (!exists)
                data.instruments.push({ id: createId("instrument"), name: asset.instrumentName, type: asset.instrumentType || "Other" });
        }
        asset.isin = type === "ovdp" ? isin : "";
        if (["s1_reit", "etf", "stock", "crypto_earn"].includes(type) && body.currentPrice !== undefined && currentPrice > 0) {
            asset.currentPrice = currentPrice;
            asset.lastSyncedAt = new Date().toISOString();
            recordAssetPrice(data, asset, "edit", asset.lastSyncedAt);
        }
        /*
         * Clear old type-specific fields.
         */
        delete asset.paymentMethod;
        delete asset.dividendPerUnit;
        delete asset.firstDividendDate;
        delete asset.maturityDate;
        delete asset.coupons;
        delete asset.annualRate;
        delete asset.earlyWithdrawal;
        asset.paymentMethod = paymentMethod;
        if (type === "etf" || type === "stock") {
            asset.paymentMethod = "capitalization";
            asset.ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
        }
        else {
            delete asset.ticker;
        }
        if (type === "savings") {
            asset.paymentMethod = "none";
            asset.currentPrice = purchasePrice;
        }
        if (type === "novapay") {
            Object.assign(asset, { termMonths: Math.min(12, Math.max(1, Math.trunc(normalizeNumber(body.termMonths)))), maturityDate: body.maturityDate, maturityAmount: normalizeNumber(body.maturityAmount), maturityAmountPerUnit: normalizeNumber(body.maturityAmount) / quantity, earlyWithdrawal: false, paymentMethod: "fixed_maturity" });
        }
        if (type === "deposit") {
            Object.assign(asset, { annualRate: normalizeNumber(body.annualRate), maturityDate: body.maturityDate, earlyWithdrawal: Boolean(body.earlyWithdrawal), paymentMethod: "deposit_interest" });
        }
        if (type === "crypto_earn") {
            const annualRate = normalizeNumber(body.annualRate);
            if (annualRate <= 0)
                throw new DomainError({ error: "Crypto Earn APR must be greater than zero." }, 400);
            Object.assign(asset, {
                ticker: String(body.ticker || name).trim().toUpperCase(),
                annualRate,
                currentPrice: currentPrice > 0 ? currentPrice : purchasePrice,
                paymentMethod: "crypto_earn",
            });
        }
        /*
         * REIT FIELDS
         */
        if (type === "inzhur_reit" || type === "s1_reit") {
            asset.dividendPerUnit = dividendPerUnit;
            asset.firstDividendDate = firstDividendDate;
        }
        /*
         * OVDP FIELDS
         */
        if (type === "ovdp") {
            asset.maturityDate = maturityDate;
            asset.coupons = coupons;
            asset.redemptionValue = normalizeNumber(body.redemptionValue) || DEFAULT_BOND_REDEMPTION;
        }
        asset.updatedAt = new Date().toISOString();
        data.transactions = data.transactions.map((transaction) => {
            if (transaction.assetId !== assetId) {
                return transaction;
            }
            return {
                ...transaction,
                assetName: asset.name,
            };
        });
        data.sales = (data.sales || []).map((sale) => {
            if (sale.assetId !== assetId) {
                return sale;
            }
            return {
                ...sale,
                assetName: asset.name,
            };
        });
        data.calendarNotes = data.calendarNotes.map((note) => {
            if (note.assetId !== assetId) {
                return note;
            }
            return {
                ...note,
                assetName: asset.name,
                currency: asset.currency,
            };
        });
        const buyTransactions = data.transactions.filter((transaction) => transaction.assetId === assetId && transaction.type === "BUY");
        const buyTransaction = buyTransactions.length === 1 ? buyTransactions[0] : null;
        if (buyTransaction) {
            buyTransaction.assetName = asset.name;
            buyTransaction.currency = asset.currency;
        }
        rules.updateSinglePurchase(data, asset);
        // Received payments and historical sale cost/profit remain immutable.
        data.payments = data.payments.filter(p => p.assetId !== assetId || rules.received(p));
        rules.updateHolding(data, asset);
        rules.rebuildPayments(data, asset, createId);
        await saveData(data);
        return asset;
    }

    async function deleteAsset(assetId) {
        const data = await readData();
        const index = data.assets.findIndex((asset) => asset.id === assetId);
        if (index === -1) {
            throw new DomainError({
                error: "Asset not found.",
            }, 404);
        }
        const [removedAsset] = data.assets.splice(index, 1);
        /*
         * Remove related transactions.
         */
        data.transactions = data.transactions.filter((transaction) => transaction.assetId !== assetId);
        /*
         * Remove related payments.
         */
        data.payments = data.payments.filter((payment) => payment.assetId !== assetId);
        /*
         * Remove related sales.
         */
        data.sales = data.sales.filter((sale) => sale.assetId !== assetId);
        /*
         * Remove related calendar notes.
         */
        data.calendarNotes = data.calendarNotes.filter((note) => note.assetId !== assetId);
        data.priceHistory = (data.priceHistory || []).filter((point) => point.assetId !== assetId);
        await saveData(data);
        return {
            success: true,
            asset: removedAsset,
        };
    }
    return { getAssets, ...mutationCommands(repository, { createAsset, updateAsset, deleteAsset }) };
}
module.exports = { createService };
