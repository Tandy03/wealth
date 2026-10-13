const rules = require('../../frontend/js/portfolio-rules');
const { BASE_CURRENCY, normalizeCurrency, normalizeNumber, createId } = require('../utils/values');
const { isValidDateString, supportsFractionalQuantity, isValidQuantity } = require('../validators');
const { validateAssetBasics, validatePurchase } = require('../validators/assets');
const { DomainError } = require('../utils/domainError');
const { recordAssetPrice, getSoldQuantity, updatePlannedPaymentsForAsset } = require('./portfolio');
const { normalizeData, recalculatePortfolio, updatePlannedPayments } = require('./state');
const { validateRequest, validateAssetCurrency, validateAssetInput } = require('../validators/requests');
const { QUANTITY_EPSILON, DEFAULT_BOND_REDEMPTION } = require('../config/constants');
const { saleFinancials } = require('./calculations');

function createService(repository, market = {}) {
  const { saveData } = repository;
  const readData = require('./readState').createStateReader(repository);
const { syncAssets } = require('./assetSyncService').createService(repository, market);
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

async function mergeAssets(assetIds = []) {
        const data = await readData();
        const ids = [...new Set(Array.isArray(assetIds) ? assetIds.map(String) : [])];
        const assets = data.assets.filter((asset) => ids.includes(asset.id));
        if (assets.length < 2)
            throw new DomainError({ error: "At least two holdings are required to merge." }, 400);
        if (assets.length !== ids.length) throw new DomainError({ error: 'One or more holdings were not found.' }, 404);
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

async function buyMoreAsset(assetId, body = {}) {
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
        updatePlannedPaymentsForAsset(data, assetId);
        rules.rebuildPayments(data, asset, createId);
        data.sales = (data.sales || []).map((sale) => {
            if (sale.assetId !== assetId) {
                return sale;
            }
            /*
             * We do not rewrite
             * historical sale results.
             *
             * Each sale keeps its
             * original stored values.
             */
            return sale;
        });
        await saveData(data);
        return {
            asset,
            transaction,
        };
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
            if (first.type === "novapay" || (first.type === "deposit" && !first.earlyWithdrawal))
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
  return { syncAssets, getAssets, createAsset: (...args) => repository.runMutation(() => createAsset(...args)), mergeAssets: (...args) => repository.runMutation(() => mergeAssets(...args)), updateAsset: (...args) => repository.runMutation(() => updateAsset(...args)), buyMoreAsset: (...args) => repository.runMutation(() => buyMoreAsset(...args)), deleteAsset: (...args) => repository.runMutation(() => deleteAsset(...args)), getSales, sellAsset: (...args) => repository.runMutation(() => sellAsset(...args)),
    normalizeData, recalculatePortfolio, updatePlannedPayments };
}
module.exports = { createService, normalizeData, recalculatePortfolio, updatePlannedPayments };
