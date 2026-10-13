const rules = require('../../frontend/js/portfolio-rules');
const { BASE_CURRENCY, normalizeNumber, createId } = require('../utils/values');
const { isValidDateString } = require('../validators');
const { recordAssetPrice, getAvailableQuantity } = require('./portfolio');
const { getTokenizedEquityPrice } = require('../services/market/binance');
const binanceCode = asset => {
  const name = String(asset.name || '').trim().toUpperCase();
  return /^[A-Z0-9.-]+B$/.test(name) ? name : String(asset.ticker || asset.symbol || name).trim().toUpperCase();
};
const isBinanceAsset = asset => ['stock', 'etf'].includes(asset.type) && (String(asset.instrumentName || '').trim().toLowerCase() === 'binance' || /^[A-Z0-9.-]+B$/.test(binanceCode(asset)));
function createService(repository, market) {
  const { saveData } = repository;
  const readData = require('./readState').createStateReader(repository);
  const { getInzhurCatalogAssets } = market;
async function syncAssets() {
        const snapshot = await readData();
        const catalog = await getInzhurCatalogAssets();
        const quotes = new Map();
        for (const asset of snapshot.assets.filter(isBinanceAsset)) {
            const code = binanceCode(asset);
            try { quotes.set(asset.id, { code, identity: rules.identity(asset), market: await getTokenizedEquityPrice(code) }); }
            catch (error) { quotes.set(asset.id, { code, identity: rules.identity(asset), error }); if (error.code === 'BINANCE_NOT_CONFIGURED') break; }
        }
        return repository.runMutation(async () => {
        const data = await readData();
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
                const quote = quotes.get(asset.id);
                if (!quote || quote.identity !== rules.identity(asset)) throw Object.assign(new Error('Holding changed while market data was loading. Retry synchronization.'), { code: 'ASSET_CHANGED' });
                if (quote.error) throw quote.error;
                const market = quote.market;
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
        rules.refreshPayments(data);
        await saveData(data);
        return {
            synced,
            skipped,
            binanceSynced,
            binanceSkipped,
            note: "Inzhur and configured Binance stock/ETF holdings were synchronized. Binance tokenized assets use the official underlying mapping and latest bid/ask midpoint.",
        };
        });
    }


  return { syncAssets };
}
module.exports = { createService };
