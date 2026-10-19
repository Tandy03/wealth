(function () {
const state = stateStore.getState();
// Dashboard action wiring.
function bindDashboardHoldings(assetsContainer) {
  assetsContainer?.querySelectorAll("[data-asset-group]").forEach(row => {
    row.tabIndex = 0; row.setAttribute('role', 'button');
    const open = () => window.ui.asset.open(row.dataset.assetGroup.split(','), { from: 'dashboard' });
    row.addEventListener('click', open);
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
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
