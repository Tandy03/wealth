(function () {
const state = stateStore.getState();
// Page event controllers; renderers never call transport directly.

function bindCalendarPaymentAction(event) {
  const markReceivedButton = document.querySelector("#mark-payment-received");

  if (markReceivedButton) {
    markReceivedButton.addEventListener("click", async () => {
      await markPaymentAsReceived(event.paymentIds || [event.id], markReceivedButton);
    });
  }


}

function bindCalendarEventButton(button, event) {
  button.addEventListener("click", clickEvent => { clickEvent.stopPropagation(); showCalendarEvent(event); });
}
function bindCalendarDay(element, date) {
  element.addEventListener("dblclick", () => openNoteModal(date));
}
Object.assign(window, { bindCalendarPaymentAction, bindCalendarEventButton, bindCalendarDay });
})();
