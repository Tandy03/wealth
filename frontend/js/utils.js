// utils.js
const typeLabels = window.FinoConstants.ASSET_TYPE_LABELS;

const DEFAULT_INSTRUMENTS = window.FinoConstants.DEFAULT_INSTRUMENTS;

const monthNames = Array.from({ length: 12 }, (_, month) => new Date(2026, month, 1).toLocaleDateString(window.FinoI18n?.locale || "en", { month: "long" }));

const currencyFormatter = new Intl.NumberFormat(window.FinoI18n?.locale || "en", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const quantityFormatter = new Intl.NumberFormat(window.FinoI18n?.locale || "en", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

function money(value, currency = "UAH") {
  const number = Number(value) || 0;

  const symbols = { UAH: "₴", USD: "$", EUR: "€" };
  return `${currencyFormatter.format(number)} ${symbols[currency] || escapeHtml(currency)}`;
}

function usdMoney(value) {
  const number = (Number(value) || 0) / EXCHANGE_RATES.USD;

  return `$${currencyFormatter.format(number)}`;
}

function formatQuantity(value) {
  return quantityFormatter.format(normalizeNumber(value));
}

function formatDate(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString(window.FinoI18n?.locale || "en");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function paymentTypeLabel(type) {
  const labels = {
    COUPON: "Coupon",
    DIVIDEND: "Dividend",
    MATURITY: "Maturity",
    CAPITALIZATION: "Capitalization",
  };

  return labels[type] || type || "-";
}

function portfolioMoneyWithUahHover(value, currency = "UAH", valueInUah = null) {
  const normalizedCurrency = String(currency || "UAH").toUpperCase();
  const original = money(value, normalizedCurrency);
  if (normalizedCurrency === "UAH") return original;
  const converted = money(Number.isFinite(valueInUah) ? valueInUah : toUAH(value, normalizedCurrency));
  return `<span class="portfolio-currency-hover" tabindex="0" data-original="${escapeHtml(original)}" data-uah="${escapeHtml(converted)}">${escapeHtml(original)}</span>`;
}

function holdingOptionLabel(asset) {
  const available = getAvailableQuantity(asset.id);
  const instrument = asset.instrumentName || window.FinoI18n.t("No instrument");
  const instrumentType = asset.instrumentType ? ` · ${window.FinoI18n.t(asset.instrumentType)}` : "";
  return `${asset.name} — ${instrument}${instrumentType} — ${window.FinoI18n.t(`${formatQuantity(available)} units`)}`;
}

function groupHoldingsByInstrument(holdings) {
  return Object.values(holdings.reduce((groups, asset) => {
    const instrumentName = String(asset.instrumentName || "No instrument").trim();
    const instrumentType = String(asset.instrumentType || "").trim();
    const currency = String(asset.currency || "UAH").toUpperCase();
    const key = `${instrumentName.toLowerCase()}::${instrumentType.toLowerCase()}::${currency}`;
    groups[key] ||= { assets: [], instrumentName, instrumentType, currency };
    groups[key].assets.push(asset);
    return groups;
  }, {}));
}

function holdingGroupLabel(group) {
  const first = group.assets[0];
  const quantity = group.assets.reduce((sum, asset) => sum + getAvailableQuantity(asset.id), 0);
  const instrumentType = group.instrumentType ? ` · ${window.FinoI18n.t(group.instrumentType)}` : "";
  const instrument = group.instrumentName === "No instrument" ? window.FinoI18n.t("No instrument") : group.instrumentName;
  return `${first.name} — ${instrument}${instrumentType} · ${group.currency} — ${window.FinoI18n.t(`${formatQuantity(quantity)} units`)}`;
}

function formatMarketPrice(value, currency = "USD") {
  return new Intl.NumberFormat(window.FinoI18n?.locale || "en", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

const walletCurrencyFormatter = new Intl.NumberFormat(window.FinoI18n?.locale || "en", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function walletMoney(value) {
  return `${walletCurrencyFormatter.format(normalizeNumber(value))} ₴`;
}

function formatWalletDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(window.FinoI18n?.locale || "en");
}
