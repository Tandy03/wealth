// renderers/transactions.js
function renderTransactions(state = stateStore.getState()) {
  const { getMaturityCostBasis, getTransactionEffectiveDate } = createRenderServices(state);
  const tbody = document.querySelector("#transactions-table");
  const assetsById = new Map((stateStore.selectAssets(state) || []).map(asset => [asset.id, asset]));
  const paymentsById = new Map((stateStore.selectPayments(state) || []).map(payment => [payment.id, payment]));
  const name = value => typeof value === 'string' ? value.trim() : '';

  if (!tbody) {
    return;
  }

  const paymentTransactionIds = new Set(
    (stateStore.selectTransactions(state) || [])
      .filter((transaction) => transaction.paymentId)
      .map((transaction) => transaction.paymentId),
  );

  const receivedPaymentTransactions = (stateStore.selectPayments(state) || [])
    .filter(
      (payment) =>
        (payment.status === "received" || payment.status === "paid") &&
        !paymentTransactionIds.has(payment.id),
    )
    .map((payment) => ({
      id: `payment-transaction-${payment.id}`,
      paymentId: payment.id,
      date: payment.receivedDate || String(payment.receivedAt || "").slice(0, 10) || payment.date,
      assetId: payment.assetId,
      assetName: payment.assetName,
      type: payment.type,
      quantity: null,
      amount: normalizeNumber(payment.amount),
      currency: payment.currency,
      isPayment: true,
    }));

  const transactions = [
    ...(stateStore.selectTransactions(state) || []),
    ...receivedPaymentTransactions,
  ].sort((a, b) =>
    String(getTransactionEffectiveDate(b) || "").localeCompare(String(getTransactionEffectiveDate(a) || "")),
  );

  if (!transactions.length) {
    tbody.innerHTML = `
            <tr>
                <td
                    colspan="7"
                    class="empty-state"
                >
                    No transactions yet.
                </td>
            </tr>
        `;

    return;
  }

  tbody.innerHTML = transactions
    .map((tx) => {
      const payment = paymentsById.get(tx.paymentId);
      const asset = assetsById.get(tx.assetId) || assetsById.get(payment?.assetId);
      const assetName = name(tx.assetName) || name(asset?.name) || name(payment?.assetName) || window.FinoI18n.t('Asset unavailable');
      const isSale = tx.type === "SELL";
      const isPayment = tx.isPayment || ["DIVIDEND", "COUPON", "MATURITY"].includes(tx.type);

      const paymentProfit = ["DIVIDEND", "COUPON"].includes(tx.type)
        ? normalizeNumber(tx.amount)
        : tx.type === "MATURITY"
          ? normalizeNumber(tx.amount) - getMaturityCostBasis(tx.assetId)
          : 0;
      const profit = tx.isPayment || ["DIVIDEND", "COUPON", "MATURITY"].includes(tx.type)
        ? paymentProfit
        : normalizeNumber(tx.profit);

      const costBasis = normalizeNumber(tx.costBasis);

      const roi = isSale && costBasis > 0 ? (profit / costBasis) * 100 : 0;

      return `
                    <tr>

                        <td>
                            ${formatDate(getTransactionEffectiveDate(tx))}
                        </td>

                        <td>
                            <strong>
                                <span translate="no">${escapeHtml(assetName)}</span>
                            </strong>
                        </td>

                        <td>
                            ${
                              isSale
                                ? `
                                        <span class="transaction-sale">
                                            SELL
                                        </span>
                                    `
                                : isPayment
                                  ? escapeHtml(paymentTypeLabel(tx.type))
                                  : escapeHtml(tx.type || "-")
                            }
                        </td>

                        <td>
                            ${tx.quantity ?? "-"}
                        </td>

                        <td>
                            ${
                              tx.amount != null
                                ? money(tx.amount, tx.currency)
                                : "-"
                            }
                        </td>

                        <td>
                            ${
                              isSale || isPayment
                                ? `
                                        <span class="${
                                          profit >= 0 ? "positive" : "negative"
                                        }">
                                            ${profit >= 0 ? "+" : ""}${money(
                                              profit,
                                              tx.currency,
                                            )}
                                        </span>
                                    `
                                : "-"
                            }
                        </td>

                        <td>
                            ${isSale ? `${roi.toFixed(2)}%` : isPayment && getMaturityCostBasis(tx.assetId) > 0 ? `${((profit / getMaturityCostBasis(tx.assetId)) * 100).toFixed(2)}%` : "-"}
                        </td>

                    </tr>
                `;
    })
    .join("");
}
