// renderers/transactions.js
function renderTransactions() {
  const tbody = document.querySelector("#transactions-table");

  if (!tbody) {
    return;
  }

  const paymentTransactionIds = new Set(
    (state.data.transactions || [])
      .filter((transaction) => transaction.paymentId)
      .map((transaction) => transaction.paymentId),
  );

  const receivedPaymentTransactions = (state.data.payments || [])
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
    ...(state.data.transactions || []),
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
                                ${escapeHtml(tx.assetName || "-")}
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
                                  ? paymentTypeLabel(tx.type)
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
