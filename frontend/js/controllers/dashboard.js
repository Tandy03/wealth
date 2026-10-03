(function () {
const state = stateStore.getState();
// Dashboard action wiring.
function bindDashboardHoldings(assetsContainer) {
  assetsContainer?.querySelectorAll("[data-asset-group]").forEach((row) => row.addEventListener("click", () => openAssetTransactions(row.dataset.assetGroup.split(","))));
}
function bindUpcomingPaymentActions(container, payments) {
  container.querySelectorAll("[data-payment-ids]").forEach((element) => {
    element.addEventListener("click", () => {
      const payment = payments.find(
        (item) => item.paymentIds.join(",") === element.dataset.paymentIds,
      );

      if (payment) {
        showCalendarEvent(payment);
      }
    });
  });
}
Object.assign(window, { bindDashboardHoldings, bindUpcomingPaymentActions });
})();
