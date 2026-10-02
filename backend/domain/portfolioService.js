const { BASE_CURRENCY, normalizeCurrency, normalizeNumber, createId } = require('../utils/values');
const { isValidDateString, supportsFractionalQuantity, isValidQuantity } = require('../validators');
const { validateAssetBasics, validatePurchase } = require('../validators/assets');
const { DomainError } = require('../utils/domainError');
const { recordAssetPrice, getSoldQuantity, getAvailableQuantity, getPurchasedQuantityOnDate, getDividendEligibleQuantity, updatePlannedPaymentsForAsset, hasReceivedPayment } = require('./portfolio');
const { normalizeData, recalculatePortfolio, updatePlannedPayments } = require('./state');
const { getTokenizedEquityPrice } = require('../services/market/binance');
const { validateRequest, validateAssetCurrency } = require('../validators/requests');
const { QUANTITY_EPSILON, DEFAULT_BOND_REDEMPTION } = require('../config/constants');
const { maturityPayout, saleFinancials } = require('./calculations');

function createService(repository, market = {}) {
  const { saveData } = repository;
  const readData = require('./readState').createStateReader(repository);
  const { getInzhurCatalogAssets } = market;
async function syncAssets() {
        const data = await readData();
        const catalog = await getInzhurCatalogAssets();
        const fundSlugs = {
            inzhur_reit: "inzhur-reit",
            inzhur_miltech: "inzhur-miltech",
        };
        const synced = [];
        const skipped = [];
        const binanceSynced = [];
        const binanceSkipped = [];
        data.assets.forEach((asset) => {
            if (!["ovdp", "inzhur_reit", "inzhur_miltech"].includes(asset.type))
                return;
            let remoteAsset = null;
            if (asset.type === "ovdp") {
                const isin = String(asset.isin || "").trim().toUpperCase();
                remoteAsset = catalog.find((item) => item.type === "bond" && item.isin === isin);
            }
            else {
                const slug = asset.inzhurSlug || fundSlugs[asset.type];
                remoteAsset = catalog.find((item) => item.type === "fund" && item.slug === slug);
            }
            if (!remoteAsset) {
                skipped.push({ id: asset.id, name: asset.name });
                return;
            }
            const currentPrice = normalizeNumber(remoteAsset.prices?.sellUAH || remoteAsset.prices?.buyUAH || remoteAsset.prices?.buy);
            if (currentPrice > 0) {
                asset.currentPrice = currentPrice;
            }
            asset.inzhurSlug = remoteAsset.slug;
            asset.lastSyncedAt = new Date().toISOString();
            if (currentPrice > 0)
                recordAssetPrice(data, asset, "sync", asset.lastSyncedAt);
            if (asset.type === "ovdp") {
                asset.maturityDate = remoteAsset.maturityDate || asset.maturityDate;
                const quantity = getAvailableQuantity(data, asset.id);
                const today = new Date().toISOString().slice(0, 10);
                const maturityDate = String(asset.maturityDate || "").slice(0, 10);
                const remoteSchedule = (remoteAsset.paymentSchedule || [])
                    .map((payment) => {
                    const amountPerUnit = normalizeNumber(payment.amount) / 100;
                    const date = String(payment.date || "").slice(0, 10);
                    const type = date === maturityDate && amountPerUnit >= 500 ? "MATURITY" : "COUPON";
                    return { date, amountPerUnit, type };
                })
                    .filter((payment) => isValidDateString(payment.date) && payment.date >= today && payment.amountPerUnit > 0);
                /* Keep the asset editor in sync with the authoritative API schedule. */
                asset.coupons = remoteSchedule
                    .filter((payment) => payment.type === "COUPON")
                    .map(({ date, amountPerUnit }) => ({ date, amountPerUnit }));
                const maturityPayment = remoteSchedule.find((payment) => payment.type === "MATURITY");
                if (maturityPayment)
                    asset.redemptionValue = maturityPayment.amountPerUnit;
                data.payments = data.payments.filter((payment) => payment.assetId !== asset.id ||
                    payment.status === "received" ||
                    payment.status === "paid" ||
                    !["COUPON", "MATURITY"].includes(payment.type));
                remoteSchedule.forEach((payment) => {
                    data.payments.push({
                        id: createId("payment"),
                        createdAt: new Date().toISOString(),
                        assetId: asset.id,
                        assetName: asset.name,
                        date: payment.date,
                        type: payment.type,
                        amountPerUnit: payment.amountPerUnit,
                        amount: payment.amountPerUnit * quantity,
                        currency: BASE_CURRENCY,
                        status: "planned",
                    });
                });
            }
            synced.push({
                id: asset.id,
                name: asset.name,
                price: asset.currentPrice || null,
                paymentScheduleUpdated: asset.type === "ovdp",
            });
        });
        const binanceAssets = data.assets.filter((asset) => {
            if (!["stock", "etf"].includes(asset.type))
                return false;
            const nameCode = String(asset.name || "").trim().toUpperCase();
            const code = /^[A-Z0-9.-]+B$/.test(nameCode) ? nameCode : String(asset.ticker || asset.symbol || nameCode).trim().toUpperCase();
            return String(asset.instrumentName || "").trim().toLowerCase() === "binance" || /^[A-Z0-9.-]+B$/.test(code);
        });
        for (const asset of binanceAssets) {
            const nameCode = String(asset.name || "").trim().toUpperCase();
            const assetCode = /^[A-Z0-9.-]+B$/.test(nameCode) ? nameCode : String(asset.ticker || asset.symbol || nameCode).trim().toUpperCase();
            try {
                const market = await getTokenizedEquityPrice(assetCode);
                asset.ticker = assetCode;
                asset.symbol = assetCode;
                asset.provider = "binance";
                asset.underlyingSymbol = market.underlyingSymbol;
                asset.currentPrice = market.currentPrice;
                asset.currency = market.quoteCurrency;
                asset.lastSyncedAt = new Date().toISOString();
                recordAssetPrice(data, asset, "sync", asset.lastSyncedAt);
                asset.marketData = {
                    provider: "binance",
                    bidPrice: market.bidPrice,
                    askPrice: market.askPrice,
                    multiplier: market.multiplier,
                    tradability: market.tradability,
                };
                binanceSynced.push({ id: asset.id, name: asset.name, symbol: assetCode, underlyingSymbol: market.underlyingSymbol, price: market.currentPrice, currency: market.quoteCurrency });
            }
            catch (error) {
                binanceSkipped.push({
                    id: asset.id,
                    name: asset.name,
                    symbol: assetCode,
                    error: error.code || "BINANCE_API_ERROR",
                    message: error.message,
                });
                if (error.code === "BINANCE_NOT_CONFIGURED")
                    break;
            }
        }
        await saveData(data);
        return {
            synced,
            skipped,
            binanceSynced,
            binanceSkipped,
            note: "Inzhur and configured Binance stock/ETF holdings were synchronized. Binance tokenized assets use the official underlying mapping and latest bid/ask midpoint.",
        };
    }

async function getAssets() {
        const data = await readData();
        return data.assets;
    }

async function createAsset(body = {}) {
        validateRequest('asset', body);
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
            Object.assign(asset, { termMonths, maturityDate, maturityAmount, paymentMethod: "fixed_maturity", earlyWithdrawal: false });
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
        if (type === "ovdp") {
            /*
             * Coupons
             */
            asset.coupons.forEach((coupon) => {
                if (hasReceivedPayment(data, asset.id, "COUPON", coupon.date))
                    return;
                data.payments.push({
                    id: createId("payment"),
                    createdAt: new Date().toISOString(),
                    assetId: asset.id,
                    assetName: asset.name,
                    date: coupon.date,
                    type: "COUPON",
                    amountPerUnit: coupon.amountPerUnit,
                    amount: coupon.amountPerUnit * quantity,
                    currency,
                    status: "planned",
                });
            });
            /*
             * Maturity / redemption
             *
             * Ukrainian domestic bonds normally redeem at nominal value.
             */
            if (!hasReceivedPayment(data, asset.id, "MATURITY", asset.maturityDate))
                data.payments.push({
                    id: createId("payment"),
                    createdAt: new Date().toISOString(),
                    assetId: asset.id,
                    assetName: asset.name,
                    date: asset.maturityDate,
                    type: "MATURITY",
                    amountPerUnit: normalizeNumber(body.redemptionValue) || DEFAULT_BOND_REDEMPTION,
                    amount: (normalizeNumber(body.redemptionValue) || DEFAULT_BOND_REDEMPTION) * quantity,
                    currency,
                    status: "planned",
                });
        }
        if (type === "inzhur_reit" || type === "s1_reit") {
            const startDate = new Date(`${asset.firstDividendDate}T00:00:00`);
            /*
             * Generate 24 monthly
             * dividend payments.
             */
            for (let i = 0; i < 24; i++) {
                const paymentDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 10);
                /*
                 * Do not generate a payment
                 * before the first dividend date.
                 */
                if (paymentDate < startDate) {
                    continue;
                }
                const dateString = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, "0")}-${String(paymentDate.getDate()).padStart(2, "0")}`;
                if (hasReceivedPayment(data, asset.id, "DIVIDEND", dateString))
                    continue;
                data.payments.push({
                    id: createId("payment"),
                    createdAt: new Date().toISOString(),
                    assetId: asset.id,
                    assetName: asset.name,
                    date: dateString,
                    type: "DIVIDEND",
                    amountPerUnit: asset.dividendPerUnit,
                    amount: asset.dividendPerUnit * getDividendEligibleQuantity(data, asset.id, dateString),
                    currency,
                    status: "planned",
                });
            }
        }
        if (type === "novapay" || type === "deposit") {
            const principal = quantity * purchasePrice;
            let payout = asset.maturityAmount;
            if (type === "deposit") {
                payout = maturityPayout(principal, asset.annualRate, purchaseDate, asset.maturityDate);
            }
            data.payments.push({ id: createId("payment"), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name, date: asset.maturityDate, type: "MATURITY", amountPerUnit: payout / quantity, amount: payout, currency, status: "planned" });
        }
        await saveData(data);
        return asset;
    }

async function mergeAssets(assetIds = []) {
        const data = await readData();
        const ids = [...new Set(Array.isArray(assetIds) ? assetIds.map(String) : [])];
        const assets = data.assets.filter((asset) => ids.includes(asset.id));
        if (assets.length < 2)
            throw new DomainError({ error: "At least two holdings are required to merge." }, 400);
        const identity = (asset) => [asset.type, asset.name, asset.instrumentName || "", asset.instrumentType || "", asset.currency || "UAH"]
            .map((value) => String(value).trim().toLowerCase()).join("::");
        if (new Set(assets.map(identity)).size !== 1) {
            throw new DomainError({ error: "Only the same asset on the same instrument can be merged." }, 400);
        }
        const primary = assets[0];
        const mergedIds = new Set(assets.slice(1).map((asset) => asset.id));
        const totalQuantity = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity), 0);
        const totalCost = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity) * normalizeNumber(asset.purchasePrice), 0);
        const totalCurrentValue = assets.reduce((sum, asset) => sum + normalizeNumber(asset.quantity) * normalizeNumber(asset.currentPrice || asset.purchasePrice), 0);
        primary.quantity = totalQuantity;
        primary.purchasePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
        primary.currentPrice = totalQuantity > 0 ? totalCurrentValue / totalQuantity : primary.currentPrice;
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
        const plannedKeys = new Set();
        data.payments = data.payments.filter((payment) => {
            if (payment.assetId !== primary.id || payment.status === "received" || payment.status === "paid")
                return true;
            if (hasReceivedPayment(data, primary.id, payment.type, payment.date))
                return false;
            const key = [payment.type, payment.date, payment.currency || primary.currency].join("|");
            if (plannedKeys.has(key))
                return false;
            plannedKeys.add(key);
            return true;
        });
        updatePlannedPaymentsForAsset(data, primary.id);
        await saveData(data);
        return primary;
    }

async function updateAsset(assetId, body = {}) {
        validateRequest('asset', body);
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
        const soldQuantity = getSoldQuantity(data, assetId);
        if (quantity < soldQuantity) {
            throw new DomainError({
                error: `Asset quantity cannot be less than already sold quantity (${soldQuantity}).`,
            }, 400);
        }
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
            Object.assign(asset, { termMonths: Math.min(12, Math.max(1, Math.trunc(normalizeNumber(body.termMonths)))), maturityDate: body.maturityDate, maturityAmount: normalizeNumber(body.maturityAmount), earlyWithdrawal: false, paymentMethod: "fixed_maturity" });
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
        data.payments = data.payments.filter((payment) => {
            if (payment.assetId !== assetId) {
                return true;
            }
            return payment.status === "received" || payment.status === "paid";
        });
        /*
         * Update preserved payment names/currency.
         */
        data.payments = data.payments.map((payment) => {
            if (payment.assetId !== assetId) {
                return payment;
            }
            return {
                ...payment,
                assetName: asset.name,
                currency: asset.currency,
            };
        });
        if (type === "ovdp") {
            asset.coupons.forEach((coupon) => {
                if (hasReceivedPayment(data, asset.id, "COUPON", coupon.date))
                    return;
                data.payments.push({
                    id: createId("payment"),
                    createdAt: new Date().toISOString(),
                    assetId: asset.id,
                    assetName: asset.name,
                    date: coupon.date,
                    type: "COUPON",
                    amountPerUnit: coupon.amountPerUnit,
                    amount: coupon.amountPerUnit * getPurchasedQuantityOnDate(data, asset.id, coupon.date),
                    currency: asset.currency,
                    status: "planned",
                });
            });
            /*
             * Maturity payment
             */
            if (!hasReceivedPayment(data, asset.id, "MATURITY", asset.maturityDate))
                data.payments.push({
                    id: createId("payment"),
                    createdAt: new Date().toISOString(),
                    assetId: asset.id,
                    assetName: asset.name,
                    date: asset.maturityDate,
                    type: "MATURITY",
                    amountPerUnit: asset.redemptionValue,
                    amount: asset.redemptionValue * asset.quantity,
                    currency: asset.currency,
                    status: "planned",
                });
        }
        if (type === "inzhur_reit" || type === "s1_reit") {
            const startDate = new Date(`${asset.firstDividendDate}T00:00:00`);
            /*
             * Generate 24 monthly dividends.
             */
            for (let i = 0; i < 24; i++) {
                const paymentDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 10);
                if (paymentDate < startDate) {
                    continue;
                }
                const dateString = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, "0")}-${String(paymentDate.getDate()).padStart(2, "0")}`;
                if (hasReceivedPayment(data, asset.id, "DIVIDEND", dateString))
                    continue;
                data.payments.push({
                    id: createId("payment"),
                    createdAt: new Date().toISOString(),
                    assetId: asset.id,
                    assetName: asset.name,
                    date: dateString,
                    type: "DIVIDEND",
                    amountPerUnit: asset.dividendPerUnit,
                    amount: asset.dividendPerUnit * getDividendEligibleQuantity(data, asset.id, dateString),
                    currency: asset.currency,
                    status: "planned",
                });
            }
        }
        if (type === "novapay" || type === "deposit") {
            const principal = asset.quantity * asset.purchasePrice;
            let payout = asset.maturityAmount;
            if (type === "deposit") {
                payout = maturityPayout(principal, asset.annualRate, asset.purchaseDate, asset.maturityDate);
            }
            if (!hasReceivedPayment(data, asset.id, "MATURITY", asset.maturityDate))
                data.payments.push({ id: createId("payment"), createdAt: new Date().toISOString(), assetId: asset.id, assetName: asset.name, date: asset.maturityDate, type: "MATURITY", amountPerUnit: payout / asset.quantity, amount: payout, currency: asset.currency, status: "planned" });
        }
        data.sales = (data.sales || []).map((sale) => {
            if (sale.assetId !== assetId) {
                return sale;
            }
            const saleQuantity = normalizeNumber(sale.quantity);
            const costBasis = saleQuantity * asset.purchasePrice;
            const saleProceeds = normalizeNumber(sale.saleProceeds);
            const profit = saleProceeds - costBasis;
            const roi = costBasis > 0 ? (profit / costBasis) * 100 : 0;
            return {
                ...sale,
                assetName: asset.name,
                type: asset.type,
                currency: asset.currency,
                purchasePrice: asset.purchasePrice,
                costBasis,
                profit,
                roi,
            };
        });
        data.transactions = data.transactions.map((transaction) => {
            if (transaction.assetId !== assetId || transaction.type !== "SELL") {
                return transaction;
            }
            const sale = data.sales.find((item) => item.assetId === assetId &&
                item.sellDate === transaction.date &&
                normalizeNumber(item.quantity) ===
                    normalizeNumber(transaction.quantity));
            if (!sale) {
                return {
                    ...transaction,
                    assetName: asset.name,
                    currency: asset.currency,
                };
            }
            return {
                ...transaction,
                assetName: asset.name,
                currency: sale.currency,
                costBasis: sale.costBasis,
                profit: sale.profit,
                roi: sale.roi,
            };
        });
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
        const oldAveragePrice = normalizeNumber(asset.purchasePrice);
        const oldCost = oldQuantity * oldAveragePrice;
        const newCost = quantity * purchasePrice;
        const totalQuantity = oldQuantity + quantity;
        const totalCost = oldCost + newCost;
        const averagePurchasePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
        asset.quantity = totalQuantity;
        asset.purchasePrice = averagePurchasePrice;
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
        updatePlannedPaymentsForAsset(data, assetId);
        if (asset.type === "novapay" || asset.type === "deposit") {
            const maturity = data.payments.find((payment) => payment.assetId === assetId && payment.type === "MATURITY" && payment.status === "planned");
            if (maturity) {
                if (asset.type === "novapay") {
                    const payoutPerUnit = normalizeNumber(maturity.amountPerUnit);
                    maturity.amount = payoutPerUnit * asset.quantity;
                }
                else {
                    maturity.amount = maturityPayout(asset.quantity * asset.purchasePrice, normalizeNumber(asset.annualRate), asset.purchaseDate, asset.maturityDate);
                    maturity.amountPerUnit = maturity.amount / asset.quantity;
                }
            }
        }
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
            const availableQuantity = groupedAssets.reduce((sum, item) => sum + getAvailableQuantity(data, item.id), 0);
            if (soldQuantity > availableQuantity + QUANTITY_EPSILON)
                throw new DomainError({ error: `You cannot sell ${soldQuantity} units. Only ${availableQuantity} units are available.` }, 400);
            let remaining = soldQuantity;
            const createdSales = [];
            const createdTransactions = [];
            for (const asset of groupedAssets) {
                if (remaining <= QUANTITY_EPSILON)
                    break;
                const quantity = Math.min(remaining, getAvailableQuantity(data, asset.id));
                if (quantity <= 0)
                    continue;
                const purchasePrice = normalizeNumber(asset.purchasePrice);
                const { costBasis, saleProceeds, profit, roi } = saleFinancials(quantity, price, purchasePrice);
                const currency = asset.currency || normalizeCurrency(body.currency);
                const createdAt = new Date().toISOString();
                const sale = { id: createId("sale"), createdAt, assetId: asset.id, assetName: asset.name, type: asset.type, quantity, sellPrice: price, sellDate, currency, purchasePrice, costBasis, saleProceeds, profit, roi };
                const transaction = { id: createId("tx"), createdAt, date: sellDate, assetId: asset.id, assetName: asset.name, type: "SELL", quantity, amount: saleProceeds, currency, costBasis, profit, roi };
                data.sales.push(sale);
                data.transactions.push(transaction);
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
        const availableQuantity = getAvailableQuantity(data, assetId);
        if (soldQuantity > availableQuantity) {
            throw new DomainError({
                error: `You cannot sell ${soldQuantity} units. ` +
                    `Only ${availableQuantity} units are available.`,
            }, 400);
        }
        const purchasePrice = normalizeNumber(asset.purchasePrice);
        const { costBasis, saleProceeds, profit, roi } = saleFinancials(soldQuantity, price, purchasePrice);
        const saleCurrency = asset.currency || normalizeCurrency(currency);
        const sale = {
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
            quantity: soldQuantity,
            amount: saleProceeds,
            currency: saleCurrency,
            costBasis,
            profit,
            roi,
        };
        data.transactions.push(transaction);
        await saveData(data);
        return {
            sale,
            transaction,
            remainingQuantity: availableQuantity - soldQuantity,
        };
    }
  return { syncAssets: (...args) => repository.runMutation(() => syncAssets(...args)), getAssets, createAsset: (...args) => repository.runMutation(() => createAsset(...args)), mergeAssets: (...args) => repository.runMutation(() => mergeAssets(...args)), updateAsset: (...args) => repository.runMutation(() => updateAsset(...args)), buyMoreAsset: (...args) => repository.runMutation(() => buyMoreAsset(...args)), deleteAsset: (...args) => repository.runMutation(() => deleteAsset(...args)), getSales, sellAsset: (...args) => repository.runMutation(() => sellAsset(...args)),
    normalizeData, recalculatePortfolio, updatePlannedPayments };
}
module.exports = { createService, normalizeData, recalculatePortfolio, updatePlannedPayments };
