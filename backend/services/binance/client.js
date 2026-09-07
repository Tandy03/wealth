const BINANCE_BASE_URL = process.env.BINANCE_BASE_URL || "https://api.binance.com";

class BinanceApiError extends Error {
  constructor(message, code = "BINANCE_API_ERROR", status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function binanceRequest(path, query = {}) {
  const apiKey = process.env.BINANCE_API_KEY;
  if (!apiKey) throw new BinanceApiError("BINANCE_API_KEY is not configured.", "BINANCE_NOT_CONFIGURED", 503);
  const url = new URL(path, BINANCE_BASE_URL);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey }, signal: controller.signal });
    if (!response.ok) {
      const limited = response.status === 418 || response.status === 429;
      throw new BinanceApiError(limited ? "Binance rate limit reached." : "Unable to retrieve Binance market data.", limited ? "BINANCE_RATE_LIMITED" : "BINANCE_API_ERROR", limited ? 429 : 502);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof BinanceApiError) throw error;
    if (error?.name === "AbortError") throw new BinanceApiError("Binance request timed out.", "BINANCE_TIMEOUT", 504);
    throw new BinanceApiError("Unable to retrieve Binance market data.");
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { BinanceApiError, binanceRequest };
