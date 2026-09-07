const { BinanceApiError, binanceRequest } = require("./client");

const TEN_MINUTES = 10 * 60 * 1000;
const THIRTY_SECONDS = 30 * 1000;
let marketCache = null;
const quoteCache = new Map();

async function getMarketCatalog() {
  if (marketCache && Date.now() - marketCache.updatedAt < TEN_MINUTES) return marketCache;
  const [exchangeInfo, tokenizedAssets] = await Promise.all([
    binanceRequest("/sapi/v1/equity/market/exchangeInfo"),
    binanceRequest("/sapi/v1/equity/market/tokenized-assets"),
  ]);
  if (!Array.isArray(exchangeInfo?.symbols) || !Array.isArray(tokenizedAssets)) {
    throw new BinanceApiError("Binance returned invalid equity market data.");
  }
  marketCache = { updatedAt: Date.now(), timezone: exchangeInfo.timezone || "UTC", symbols: exchangeInfo.symbols, tokenizedAssets };
  return marketCache;
}

async function getQuote(symbol) {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.updatedAt < THIRTY_SECONDS) return cached.quote;
  const quote = await binanceRequest("/sapi/v1/equity/market/quote", { symbol });
  if (!quote) throw new BinanceApiError(`No current quote is available for ${symbol}.`, "QUOTE_NOT_AVAILABLE", 404);
  quoteCache.set(symbol, { updatedAt: Date.now(), quote });
  return quote;
}

async function getTokenizedEquityPrice(assetCode) {
  const code = String(assetCode || "").trim().toUpperCase();
  const catalog = await getMarketCatalog();
  const tokenized = catalog.tokenizedAssets.find((item) => String(item.assetCode).toUpperCase() === code);
  const underlyingSymbol = String(tokenized?.underlyingEquitySymbol || code).toUpperCase();
  const exchangeInfo = catalog.symbols.find((item) => String(item.symbol).toUpperCase() === underlyingSymbol);
  if (!exchangeInfo) throw new BinanceApiError(`${code} is not available in Binance equity market data.`, "EQUITY_NOT_FOUND", 404);
  const quote = await getQuote(underlyingSymbol);
  const bid = Number(quote.bidPrice);
  const ask = Number(quote.askPrice);
  const underlyingPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : (bid > 0 ? bid : ask);
  const multiplier = tokenized && Number(tokenized.multiplier) > 0 ? Number(tokenized.multiplier) : 1;
  if (!(underlyingPrice > 0)) throw new BinanceApiError(`No usable quote is available for ${underlyingSymbol}.`, "QUOTE_NOT_AVAILABLE", 404);
  return { assetCode: code, underlyingSymbol, currentPrice: underlyingPrice * multiplier, bidPrice: bid || null, askPrice: ask || null, multiplier, tradability: exchangeInfo.tradability, quoteCurrency: "USD" };
}

module.exports = { getTokenizedEquityPrice };
