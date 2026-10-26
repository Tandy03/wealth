// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createRenderersCalendar({
  FinoI18n,
  bindCalendarDay,
  bindCalendarEventButton,
  bindCalendarPaymentAction,
  createRenderServices,
  document,
  escapeHtml,
  formatDate,
  getDateString,
  money,
  normalizeNumber,
  paymentTypeLabel,
  stateStore,
}) {
// renderers/calendar.js
function renderCalendar(state = stateStore.getState()) {
  const { getCalendarEvents } = createRenderServices(state);
  const title = document.querySelector('#calendar-month-title');
  const grid = document.querySelector('#calendar-grid');
  const agenda = document.querySelector('#calendar-day-events');
  if (!title || !grid || !agenda) return;
  const locale = FinoI18n?.locale || 'en';
  const t = text => FinoI18n?.t(text) || text;
  const year = state.calendarDate.getFullYear(), month = state.calendarDate.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const selected = state.calendarSelectedDate || getDateString(state.calendarDate);
  const today = getDateString(new Date());
  const events = getCalendarEvents();
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.date)) grouped.set(event.date, []);
    grouped.get(event.date).push(event);
  }
  const received = event => event.source === 'payment' && ['received', 'paid'].includes(event.status);
  const category = event => ['dividend', 'coupon', 'maturity', 'note'].includes(event.category) ? event.category : 'coupon';
  title.textContent = state.calendarDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  document.querySelector('#calendar-month-picker').value = monthKey;
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const fragment = document.createDocumentFragment();
  for (let cell = 0; cell < cells; cell++) {
    const date = new Date(year, month, cell - offset + 1);
    const dateString = getDateString(date);
    const dayEvents = grouped.get(dateString) || [];
    const day = document.createElement('button');
    day.type = 'button';
    day.className = 'calendar-day';
    day.dataset.calendarDate = dateString;
    day.classList.toggle('other-month', date.getMonth() !== month);
    day.classList.toggle('today', dateString === today);
    day.classList.toggle('selected', dateString === selected);
    day.setAttribute('aria-pressed', String(dateString === selected));
    day.setAttribute('aria-label', `${date.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}; ${dayEvents.length} ${t('events')}`);
    if (dateString === today) day.setAttribute('aria-current', 'date');
    day.tabIndex = dateString === selected ? 0 : -1;
    day.innerHTML = `<span class="calendar-day-number">${date.getDate()}</span><span class="calendar-events" aria-hidden="true">${dayEvents.slice(0, 4).map(event => `<i class="calendar-event-dot ${category(event)}${received(event) ? ' received' : ''}"></i>`).join('')}${dayEvents.length > 4 ? `<span class="calendar-more">+${dayEvents.length - 4}</span>` : ''}</span>`;
    bindCalendarDay(day, dateString);
    fragment.appendChild(day);
  }
  grid.replaceChildren(fragment);
  const monthCount = events.filter(event => String(event.date).startsWith(monthKey)).length;
  document.querySelector('#calendar-month-count').textContent = `${monthCount} ${t('events this month')}`;
  const selectedDate = new Date(`${selected}T12:00:00`);
  document.querySelector('#calendar-selected-title').textContent = selectedDate.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const dayEvents = grouped.get(selected) || [];
  const count = document.querySelector('#calendar-day-count');
  count.textContent = String(dayEvents.length);
  count.hidden = dayEvents.length === 0;
  agenda.replaceChildren();
  if (!dayEvents.length) {
    agenda.innerHTML = '<div class="calendar-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="10" width="32" height="30" rx="7"/><path d="M16 6v8M32 6v8M8 21h32M18 28h4M26 28h4M18 33h4"/></svg><strong>No events for this day</strong><p>Select another date or add a planned purchase.</p></div>';
  }
  for (const event of dayEvents) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calendar-event calendar-agenda-card ${category(event)}${received(event) ? ' received' : ''}`;
    const type = event.source === 'note' ? 'Planned purchase' : paymentTypeLabel(event.type);
    button.innerHTML = `<i class="calendar-event-dot ${category(event)}${received(event) ? ' received' : ''}" aria-hidden="true"></i><span class="calendar-card-content"><strong class="calendar-event-title" translate="no">${escapeHtml(event.title || t('Event'))}</strong><span class="calendar-card-meta">${escapeHtml(t(type))}${event.source === 'payment' ? `<span class="calendar-event-status">${t(received(event) ? 'Received' : 'Planned')}</span>` : ''}</span>${event.source === 'note' && event.text ? `<span class="calendar-card-note" translate="no">${escapeHtml(event.text)}</span>` : ''}</span>${event.amount != null && normalizeNumber(event.amount) > 0 ? `<strong class="calendar-event-amount">${money(event.amount, event.currency)}</strong>` : '<span class="calendar-card-arrow" aria-hidden="true">›</span>'}`;
    bindCalendarEventButton(button, event);
    agenda.appendChild(button);
  }
}

function showCalendarEvent(event) {
  const modal = document.querySelector("#event-modal");

  const title = document.querySelector("#event-modal-title");

  const content = document.querySelector("#event-modal-content");

  if (!modal || !title || !content) {
    return;
  }

  title.textContent = event.title || "Event";
  title.setAttribute("translate", event.title ? "no" : "yes");

  let html = `
        <div class="event-details">

            <div class="event-detail">

                <div class="event-detail-label">
                    Date
                </div>

                <div class="event-detail-value">
                    ${formatDate(event.date)}
                </div>

            </div>


            <div class="event-detail">

                <div class="event-detail-label">
                    Type
                </div>

                <div class="event-detail-value">
                    ${
                      event.source === "note"
                        ? "Planned purchase"
                        : escapeHtml(paymentTypeLabel(event.type))
                    }
                </div>

            </div>
    `;

  /*
   * Amount
   */

  if (event.amount != null && normalizeNumber(event.amount) > 0) {
    html += `
            <div class="event-detail">

                <div class="event-detail-label">
                    Amount
                </div>

                <div class="event-detail-value">
                    ${money(event.amount, event.currency)}
                </div>

            </div>
        `;
  }

  /*
   * Payment status
   */

  if (event.source === "payment") {
    html += `
            <div class="event-detail">

                <div class="event-detail-label">
                    Status
                </div>

                <div class="event-detail-value">
                    ${
                      event.status === "received" || event.status === "paid"
                        ? "Received"
                        : "Planned"
                    }
                </div>

            </div>
        `;
  }

  /*
   * Note text
   */

  if (event.source === "note" && event.text) {
    html += `
            <div class="event-detail">

                <div class="event-detail-label">
                    Note
                </div>

                <div class="event-detail-value">
                    <span translate="no">${escapeHtml(event.text)}</span>
                </div>

            </div>
        `;
  }

  /*
   * Mark as received
   *
   * Only for actual payments.
   */

  if (
    event.source === "payment" &&
    event.status !== "received" &&
    event.status !== "paid"
  ) {
    html += `
            <div
                class="event-action"
                style="margin-top:20px;"
            >

                <button
                    type="button"
                    class="primary-btn"
                    id="mark-payment-received"
                >
                    Mark as received
                </button>

            </div>
        `;
  }

  /*
   * Already received
   */

  if (
    event.source === "payment" &&
    (event.status === "received" || event.status === "paid")
  ) {
    html += `
            <div
                class="event-action"
                style="margin-top:20px;"
            >

                <div class="positive">
                    ✓ Payment received
                </div>

            </div>
        `;
  }

  html += `
        </div>
    `;

  content.innerHTML = html;

  /*
   * Mark received button
   */

  bindCalendarPaymentAction(event);

  modal.classList.add("open");
}
return { renderCalendar, showCalendarEvent };
}
