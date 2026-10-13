(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./portfolio-rules') : root.FinoPortfolioRules);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PortfolioPerformance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (rules) {
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const day = (value) => String(value || "").slice(0, 10);
  const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(day(value));
  const received = (payment) => payment?.status === "received" || payment?.status === "paid" || payment?.received === true;

  function buildWeeklyPerformance(data, options = {}) {
    const assets = new Map((data.assets || []).filter((asset) => asset.type !== "savings").map((asset) => [asset.id, asset]));
    const fx = options.exchangeRateOnDate || ((currency) => currency === "UAH" ? 1 : null);
    const today = validDay(options.today) ? day(options.today) : new Date().toISOString().slice(0, 10);
    const events = [];
    const lots = new Map();
    const prices = new Map();
    const addPrice = (assetId, date, timestamp, price) => {
      if (!assets.has(assetId) || !validDay(date) || !(number(price) > 0)) return;
      if (!prices.has(assetId)) prices.set(assetId, []);
      prices.get(assetId).push({ date: day(date), timestamp: String(timestamp || date), price: number(price) });
    };

    (data.transactions || []).filter((tx) => tx.type === "BUY" && assets.has(tx.assetId) && validDay(tx.date)).forEach((tx) => {
      const asset = assets.get(tx.assetId);
      const quantity = number(tx.quantity);
      const price = number(tx.purchasePrice) || (quantity > 0 ? number(tx.amount) / quantity : 0);
      if (!(quantity > 0) || !(price > 0)) return;
      events.push({ kind: "buy", sequence: data.transactions.indexOf(tx), date: day(tx.date), timestamp: String(tx.createdAt || tx.date), assetId: tx.assetId, quantity, price, currency: tx.currency || asset.currency || "UAH" });
      addPrice(tx.assetId, tx.date, tx.createdAt || tx.date, price);
    });
    (data.priceHistory || []).forEach((point) => addPrice(point.assetId, point.recordedAt || point.date, point.recordedAt || point.date, point.price));
    prices.forEach((series) => series.sort((a, b) => a.date.localeCompare(b.date) || a.timestamp.localeCompare(b.timestamp)));

    (data.sales || []).filter((sale) => assets.has(sale.assetId) && validDay(sale.sellDate)).forEach((sale) => {
      events.push({ kind: "sale", method: sale.costBasisMethod, sequence: (data.transactions || []).findIndex(tx => (sale.id && tx.saleId === sale.id) || (tx.type === "SELL" && tx.assetId === sale.assetId && tx.date === sale.sellDate && number(tx.quantity) === number(sale.quantity))), date: day(sale.sellDate), timestamp: String(sale.createdAt || sale.sellDate), assetId: sale.assetId, quantity: number(sale.quantity), proceeds: number(sale.saleProceeds) || number(sale.quantity) * number(sale.sellPrice), fees: number(sale.fees), currency: sale.currency || assets.get(sale.assetId)?.currency || "UAH" });
    });
    (data.transactions || []).filter((tx) => tx.type === "SELL" && assets.has(tx.assetId) && validDay(tx.date)).forEach((tx) => {
      const duplicate = (data.sales || []).some((sale) => sale.assetId === tx.assetId && day(sale.sellDate) === day(tx.date) && Math.abs(number(sale.quantity) - number(tx.quantity)) < 1e-9 && Math.abs((number(sale.saleProceeds) || number(sale.quantity) * number(sale.sellPrice)) - number(tx.amount)) < 0.01);
      if (!duplicate) events.push({ kind: "sale", method: tx.costBasisMethod, sequence: data.transactions.indexOf(tx), date: day(tx.date), timestamp: String(tx.createdAt || tx.date), assetId: tx.assetId, quantity: number(tx.quantity), proceeds: number(tx.amount), fees: number(tx.fees), currency: tx.currency || assets.get(tx.assetId)?.currency || "UAH" });
    });

    const paymentIds = new Set();
    (data.payments || []).filter((payment) => received(payment) && assets.has(payment.assetId)).forEach((payment) => {
      const date = day(payment.receivedDate || payment.receivedAt || payment.date);
      if (!validDay(date)) return;
      if (payment.id) paymentIds.add(payment.id);
      events.push({ kind: payment.type === "MATURITY" ? "maturity" : "income", date, timestamp: String(payment.receivedAt || date), assetId: payment.assetId, amount: number(payment.amount), currency: payment.currency || assets.get(payment.assetId)?.currency || "UAH" });
    });
    (data.transactions || []).filter((tx) => ["DIVIDEND", "COUPON", "MATURITY"].includes(tx.type) && assets.has(tx.assetId) && validDay(tx.date) && (!tx.paymentId || !paymentIds.has(tx.paymentId))).forEach((tx) => {
      events.push({ kind: tx.type === "MATURITY" ? "maturity" : "income", date: day(tx.date), timestamp: String(tx.createdAt || tx.date), assetId: tx.assetId, amount: number(tx.amount), currency: tx.currency || assets.get(tx.assetId)?.currency || "UAH" });
    });
    const order = { buy: 0, sale: 1, income: 2, maturity: 3 };
    events.sort((a, b) => a.date.localeCompare(b.date) || ((a.sequence >= 0 ? a.sequence : Infinity) - (b.sequence >= 0 ? b.sequence : Infinity)) || a.timestamp.localeCompare(b.timestamp) || order[a.kind] - order[b.kind]);
    if (!events.length) return { points: [], limitations: [] };

    const growthFactor = (assetId, startDate, targetDate) => {
      const asset = assets.get(assetId);
      if (asset?.type !== "crypto_earn") return 1;
      const rate = Math.max(0, number(asset.annualRate)) / 100;
      const started = new Date(`${day(startDate)}T00:00:00Z`).getTime();
      const ended = new Date(`${day(targetDate)}T00:00:00Z`).getTime();
      const days = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.floor((ended - started) / 86400000)) : 0;
      return (1 + rate / 365) ** days;
    };
    const consume = (assetId, requested, date, method) => rules.consumeLots(lots.get(assetId) || [], requested, lot => growthFactor(assetId, lot.date, date), method === 'moving_average');
    const priceAt = (assetId, date) => {
      let found = null;
      for (const point of prices.get(assetId) || []) {
        if (point.date > date) break;
        found = point;
      }
      return found?.price ?? null;
    };
    const rateAt = (currency, date) => {
      if (!currency || currency === "UAH") return 1;
      const value = fx(currency, date);
      return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
    };
    const points = [];
    const limitations = new Set();
    let reliable = true;
    let realized = 0;
    let income = 0;
    let index = 0;
    const cursor = new Date(`${events[0].date}T12:00:00`);
    const end = new Date(`${today}T12:00:00`);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      while (index < events.length && events[index].date <= date) {
        const event = events[index++];
        const rate = rateAt(event.currency, event.date);
        if (event.kind === "buy") {
          if (rate == null) { limitations.add(`Missing ${event.currency} rate for ${event.date}`); reliable = false; }
          if (!lots.has(event.assetId)) lots.set(event.assetId, []);
          lots.get(event.assetId).push({ date: event.date, quantity: event.quantity, unitCostUah: rate == null ? NaN : event.price * rate });
        } else if (event.kind === "sale") {
          const consumed = consume(event.assetId, event.quantity, event.date, event.method);
          if (consumed.shortfall > 1e-9) { limitations.add(`Sale exceeds reconstructed quantity for ${event.assetId} on ${event.date}`); reliable = false; }
          if (rate == null || !Number.isFinite(consumed.basis)) { limitations.add(`Sale result unavailable for ${event.assetId} on ${event.date}`); reliable = false; }
          else realized += (event.proceeds - event.fees) * rate - consumed.basis;
        } else if (event.kind === "maturity") {
          const quantity = (lots.get(event.assetId) || []).reduce((sum, lot) => sum + Math.max(0, lot.quantity), 0);
          const consumed = consume(event.assetId, quantity, event.date);
          if (rate == null || !Number.isFinite(consumed.basis)) { limitations.add(`Maturity result unavailable for ${event.assetId} on ${event.date}`); reliable = false; }
          else realized += event.amount * rate - consumed.basis;
        } else if (event.kind === "income") {
          if (rate == null) { limitations.add(`Income conversion unavailable for ${event.assetId} on ${event.date}`); reliable = false; }
          else income += event.amount * rate;
        }
      }
      if (cursor.getDay() === 0 || date === today) {
        let unrealized = 0;
        let available = true;
        lots.forEach((assetLots, assetId) => {
          const quantity = assetLots.reduce((sum, lot) => sum + Math.max(0, lot.quantity) * growthFactor(assetId, lot.date, date), 0);
          if (quantity <= 1e-9) return;
          const asset = assets.get(assetId);
          const price = priceAt(assetId, date);
          const rate = rateAt(asset?.currency || "UAH", date);
          const basis = assetLots.reduce((sum, lot) => sum + Math.max(0, lot.quantity) * lot.unitCostUah, 0);
          if (price == null || rate == null || !Number.isFinite(basis)) available = false;
          else unrealized += quantity * price * rate - basis;
        });
        points.push({ date, value: available && reliable ? realized + income + unrealized : null, realized, income, unrealized: available ? unrealized : null });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return { points, limitations: [...limitations] };
  }

  return { buildWeeklyPerformance };
});
