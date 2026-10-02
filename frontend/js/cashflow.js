(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoCashflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createService({ state, market, finance, values }) {
    const { normalizeNumber, getDateString, isDateInRange } = values;
    const { toUAH, toUAHAtDate, toUAHPurchaseCost, getAssetPurchaseDate } = market;
    const { calculatePortfolioValue, getMaturityCostBasis, getAvailableQuantity, getAssetInvestedUah, getUnrealizedPriceGrowth } = finance;
function calculateXirr(cashFlows) {
  const grouped = new Map();
  cashFlows.forEach(({ date, amount }) => {
    const normalizedDate = String(date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !Number.isFinite(amount) || amount === 0) return;
    grouped.set(normalizedDate, (grouped.get(normalizedDate) || 0) + amount);
  });
  const flows = [...grouped].map(([date, amount]) => ({ date: new Date(`${date}T00:00:00Z`), amount })).sort((a, b) => a.date - b.date);
  if (flows.length < 2 || !flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  const origin = flows[0].date.getTime();
  const npv = (rate) => flows.reduce((sum, flow) => sum + flow.amount / ((1 + rate) ** ((flow.date.getTime() - origin) / 31557600000)), 0);
  let low = -0.9999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (lowValue * highValue > 0 && high < 1000000) {
    high *= 2;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (!Number.isFinite(middleValue)) return null;
    if (Math.abs(middleValue) < 0.01) return middle;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
}

function calculatePortfolioXirr() {
  const assetsById = new Map((state.data.assets || []).map((asset) => [asset.id, asset]));
  const cashFlows = (state.data.transactions || [])
    .filter((transaction) => transaction.type === "BUY" && transaction.date && assetsById.get(transaction.assetId)?.type !== "savings")
    .map((transaction) => ({
      date: transaction.date,
      amount: -toUAHAtDate(normalizeNumber(transaction.amount) || normalizeNumber(transaction.quantity) * normalizeNumber(transaction.purchasePrice ?? transaction.price), transaction.currency || assetsById.get(transaction.assetId)?.currency, transaction.date),
    }));
  (state.data.sales || []).filter((sale) => sale.sellDate && sale.type !== "savings").forEach((sale) => {
    const proceeds = normalizeNumber(sale.saleProceeds) || normalizeNumber(sale.quantity) * normalizeNumber(sale.sellPrice);
    cashFlows.push({ date: sale.sellDate, amount: toUAHAtDate(proceeds, sale.currency, sale.sellDate) });
  });
  (state.data.payments || []).filter((payment) => payment.status === "received" || payment.status === "paid").forEach((payment) => {
    const date = payment.receivedDate || String(payment.receivedAt || "").slice(0, 10) || payment.date;
    cashFlows.push({ date, amount: toUAHAtDate(normalizeNumber(payment.amount), payment.currency, date) });
  });
  const currentValue = calculatePortfolioValue();
  if (currentValue > 0) cashFlows.push({ date: getDateString(new Date()), amount: currentValue });
  return calculateXirr(cashFlows);
}

function calculateProfit(from = null, to = null) {
  const result = {
    dividends: 0,
    coupons: 0,
    maturity: 0,
    salesProfit: 0,
    priceGrowth: 0,
    totalProfit: 0,
    invested: 0,
    assets: {},
  };

  /*
   * RECEIVED PAYMENTS ONLY
   */

  (state.data.payments || [])
    .filter(
      (payment) =>
        (payment.status === "received" || payment.status === "paid") &&
        isDateInRange(payment.date, from, to),
    )
    .forEach((payment) => {
      const amount = toUAH(payment.amount, payment.currency);

      const sourceAsset = state.data.assets.find((asset) => asset.id === payment.assetId);
      const assetId = `${sourceAsset?.type || payment.type || "unknown"}::${String(sourceAsset?.name || payment.assetName || "Unknown").trim().toLowerCase()}`;

      if (!result.assets[assetId]) {
        result.assets[assetId] = {
          assetName: payment.assetName || "Unknown",

          currency: "UAH",

          invested: 0,

          dividends: 0,

          coupons: 0,

          maturity: 0,

          salesProfit: 0,

          priceGrowth: 0,
        };
      }

      if (payment.type === "DIVIDEND") {
        result.dividends += amount;

        result.assets[assetId].dividends += amount;
      }

      if (payment.type === "COUPON") {
        result.coupons += amount;

        result.assets[assetId].coupons += amount;
      }

      if (payment.type === "MATURITY") {
        const netMaturity = amount - toUAHPurchaseCost(
          getMaturityCostBasis(payment.assetId),
          payment.currency,
          payment.assetId,
          getAssetPurchaseDate(payment.assetId, payment.date),
        );

        result.maturity += netMaturity;

        result.assets[assetId].maturity += netMaturity;
      }
    });

  /*
   * SALES
   */

  (state.data.sales || [])
    .filter((sale) => sale.type !== "savings" && isDateInRange(sale.sellDate, from, to))
    .forEach((sale) => {
      const profit = toUAH(normalizeNumber(sale.profit), sale.currency);

      const costBasis = toUAHPurchaseCost(
        sale.costBasis,
        sale.currency,
        sale.assetId,
        getAssetPurchaseDate(sale.assetId, sale.sellDate),
      );

      const sourceAsset = state.data.assets.find((asset) => asset.id === sale.assetId);
      const assetId = `${sourceAsset?.type || sale.type || "unknown"}::${String(sourceAsset?.name || sale.assetName || "Unknown").trim().toLowerCase()}`;

      if (!result.assets[assetId]) {
        result.assets[assetId] = {
          assetName: sale.assetName || "Unknown",

          currency: "UAH",

          invested: 0,

          dividends: 0,

          coupons: 0,

          maturity: 0,

          salesProfit: 0,

          priceGrowth: 0,
        };
      }

      result.salesProfit += profit;

      result.assets[assetId].salesProfit += profit;

      result.assets[assetId].invested += costBasis;

      result.invested += costBasis;
    });

  state.data.assets
    .filter((asset) => getAvailableQuantity(asset.id) > 0 && asset.type !== "savings")
    .forEach((asset) => {
      const assetId = `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
      const invested = getAssetInvestedUah(asset);
      const priceGrowth = toUAH(getUnrealizedPriceGrowth(asset), asset.currency);

      if (!result.assets[assetId]) {
        result.assets[assetId] = {
          assetName: asset.name,
          currency: "UAH",
          invested: 0,
          dividends: 0,
          coupons: 0,
          maturity: 0,
          salesProfit: 0,
          priceGrowth: 0,
        };
      }

      result.assets[assetId].invested += invested;
      result.assets[assetId].priceGrowth += priceGrowth;
      result.invested += invested;
      result.priceGrowth += priceGrowth;
    });

  result.totalProfit =
    result.dividends +
    result.coupons +
    result.maturity +
    result.salesProfit +
    result.priceGrowth;

  result.roi =
    result.invested > 0 ? (result.totalProfit / result.invested) * 100 : 0;

  return result;
}

function getTransactionEffectiveDate(transaction) {
  if (!transaction?.paymentId) return transaction?.date;
  const payment = (state.data.payments || []).find((item) => item.id === transaction.paymentId);
  return payment?.receivedDate || String(payment?.receivedAt || "").slice(0, 10) || transaction.date;
}

function getCalendarEvents() {
  const paymentEvents = groupPaymentEvents(state.data.payments || []);

  const noteEvents = (state.data.calendarNotes || []).map((note) => ({
    id: note.id,
    source: "note",
    date: note.date,
    category: "note",
    title: note.assetName || "Planned purchase",
    amount: note.amount,
    currency: note.currency || "UAH",
    type: "PLANNED_PURCHASE",
    text: note.text,
    assetId: note.assetId,
  }));

  return [...paymentEvents, ...noteEvents];
}

function paymentToCalendarEvent(payment) {
    let category = "coupon";

    if (payment.type === "DIVIDEND") {
      category = "dividend";
    }

    if (payment.type === "MATURITY") {
      category = "maturity";
    }

    return {
      id: payment.id,
      paymentIds: payment.paymentIds || [payment.id],

      source: "payment",

      date: payment.date,

      category,

      title: payment.assetName,

      amount: payment.amount,

      currency: payment.currency,

      type: payment.type,

      assetId: payment.assetId,

      status: payment.status,
    };
}

function groupPaymentEvents(payments) {
  const groups = new Map();
  payments.forEach((payment) => {
    const asset = (state.data.assets || []).find((item) => item.id === payment.assetId);
    const assetName = String(asset?.name || payment.assetName || "Payment").trim();
    const assetType = asset?.type || "";
    const statusGroup = payment.status === "received" || payment.status === "paid" ? "received" : "planned";
    const key = [payment.date, payment.type, payment.currency || "UAH", assetType, assetName.toLocaleLowerCase(), statusGroup].join("|");
    const existing = groups.get(key);
    if (existing) {
      existing.amount += normalizeNumber(payment.amount);
      existing.paymentIds.push(payment.id);
    } else {
      groups.set(key, paymentToCalendarEvent({ ...payment, assetName, paymentIds: [payment.id] }));
    }
  });
  return [...groups.values()];
}
function summarizeProfit(result, labels = {}) {
  const metrics = ['invested', 'dividends', 'coupons', 'maturity', 'salesProfit', 'priceGrowth'];
  const summarize = row => {
    const totalProfit = metrics.filter(key => key !== 'invested').reduce((sum, key) => sum + normalizeNumber(row[key]), 0);
    return { ...row, totalProfit, roi: row.invested > 0 ? totalProfit / row.invested * 100 : 0 };
  };
  const assetRows = Object.values(result.assets).map(asset => summarize({ ...asset, label: asset.assetName }));
  const groups = new Map();
  for (const [id, asset] of Object.entries(result.assets)) {
    const type = id.split('::', 1)[0] || 'unknown';
    if (!groups.has(type)) groups.set(type, { label: labels[type] || type, currency: 'UAH', ...Object.fromEntries(metrics.map(key => [key, 0])) });
    const row = groups.get(type);
    for (const key of metrics) row[key] += normalizeNumber(asset[key]);
  }
  return { assetRows, typeRows: [...groups.values()].map(summarize) };
}
    return { summarizeProfit, calculateXirr, calculatePortfolioXirr, calculateProfit, getTransactionEffectiveDate, getCalendarEvents, paymentToCalendarEvent, groupPaymentEvents };
  }
  return { createService };
});
