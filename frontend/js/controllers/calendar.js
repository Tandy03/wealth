// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createControllersCalendar({
  document,
  getDateString,
  markPaymentAsReceived,
  openNoteModal,
  renderCalendar,
  showCalendarEvent,
  stateStore,
}) {
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
  const select = (value, focus = false) => {
    if (value !== stateStore.selectUI('calendarSelectedDate')) {
      const selected = new Date(`${value}T12:00:00`);
      stateStore.setUI({ calendarSelectedDate: value, calendarDate: new Date(selected.getFullYear(), selected.getMonth(), 1) });
      renderCalendar();
    }
    if (focus) document.querySelector(`[data-calendar-date="${value}"]`)?.focus({ preventScroll: true });
  };
  element.addEventListener('click', () => select(date, true));
  element.addEventListener('keydown', event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + offset);
    select(getDateString(next), true);
  });
  element.addEventListener("dblclick", () => openNoteModal(date));
}
return { bindCalendarDay, bindCalendarEventButton, bindCalendarPaymentAction };
}
