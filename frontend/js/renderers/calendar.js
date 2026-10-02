// renderers/calendar.js
function renderCalendar() {
  const title = document.querySelector("#calendar-month-title");

  const grid = document.querySelector("#calendar-grid");

  if (!title || !grid) {
    return;
  }

  const year = state.calendarDate.getFullYear();

  const month = state.calendarDate.getMonth();

  title.textContent = `${monthNames[month]} ${year}`;

  grid.innerHTML = "";

  const firstDay = new Date(year, month, 1);

  let startDay = firstDay.getDay();

  /*
   * Convert Sunday = 0
   * to Sunday = 7
   */

  if (startDay === 0) {
    startDay = 7;
  }

  const daysInPreviousMonth = new Date(year, month, 0).getDate();

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = getDateString(new Date());

  const events = getCalendarEvents();

  /*
   * 6 weeks = 42 cells
   */

  for (let cell = 1; cell <= 42; cell++) {
    const dayElement = document.createElement("div");

    dayElement.className = "calendar-day";

    let date;
    let dayNumber;

    /*
     * Previous month
     */

    if (cell < startDay) {
      dayNumber = daysInPreviousMonth - startDay + cell;

      date = new Date(year, month - 1, dayNumber);

      dayElement.classList.add("other-month");
    } else if (cell >= startDay + daysInMonth) {

    /*
     * Next month
     */
      dayNumber = cell - startDay - daysInMonth + 1;

      date = new Date(year, month + 1, dayNumber);

      dayElement.classList.add("other-month");
    } else {

    /*
     * Current month
     */
      dayNumber = cell - startDay + 1;

      date = new Date(year, month, dayNumber);
    }

    const dateString = getDateString(date);

    if (dateString === today) {
      dayElement.classList.add("today");
    }

    const number = document.createElement("div");

    number.className = "calendar-day-number";

    number.textContent = dayNumber;

    dayElement.appendChild(number);

    const eventsContainer = document.createElement("div");

    eventsContainer.className = "calendar-events";

    const dayEvents = events.filter((event) => event.date === dateString);

    dayEvents.slice(0, 5).forEach((event) => {
      const eventButton = document.createElement("button");

      eventButton.type = "button";

      eventButton.className = `calendar-event ${event.category}`;

      if (
        event.source === "payment" &&
        (event.status === "received" || event.status === "paid")
      ) {
        eventButton.classList.add("received");
      }

      eventButton.innerHTML = `
                    <div
                        class="calendar-event-title"
                    >
                        ${escapeHtml(event.title)}
                    </div>

                    ${
                      event.amount != null && normalizeNumber(event.amount) > 0
                        ? `
                                <div
                                    class="calendar-event-amount"
                                >
                                    ${money(event.amount, event.currency)}
                                </div>
                            `
                        : ""
                    }

                    ${
                      event.source === "payment" &&
                      (event.status === "received" || event.status === "paid")
                        ? `
                                <div class="calendar-event-status">
                                    Received
                                </div>
                            `
                        : ""
                    }
                `;

      eventButton.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();

        showCalendarEvent(event);
      });

      eventsContainer.appendChild(eventButton);
    });

    if (dayEvents.length > 5) {
      const more = document.createElement("div");

      more.className = "calendar-event";

      more.textContent = `+ ${dayEvents.length - 5} more`;

      eventsContainer.appendChild(more);
    }

    dayElement.appendChild(eventsContainer);

    /*
     * Double-click day
     * -> planned purchase note
     */

    dayElement.addEventListener("dblclick", () => {
      openNoteModal(dateString);
    });

    grid.appendChild(dayElement);
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
                        : paymentTypeLabel(event.type)
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
                    ${escapeHtml(event.text)}
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

  const markReceivedButton = document.querySelector("#mark-payment-received");

  if (markReceivedButton) {
    markReceivedButton.addEventListener("click", async () => {
      await markPaymentAsReceived(event.paymentIds || [event.id], markReceivedButton);
    });
  }

  modal.classList.add("open");
}
