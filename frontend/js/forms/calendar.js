// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createFormsCalendar({
  FinoErrors,
  FormData,
  api,
  console,
  document,
  financialCommand,
  getDateString,
  loadData,
  normalizeNumber,
  renderCalendar,
  renderDashboard,
  renderProfitCalculator,
  showNotice,
  stateStore,
}) {
// forms/calendar.js
async function markPaymentAsReceived(paymentIds, button = null) {
  const ids = Array.isArray(paymentIds) ? paymentIds : [paymentIds];
  const payments = ids.map((id) => stateStore.selectPayments().find((item) => item.id === id)).filter(Boolean);

  if (!payments.length) {
    showNotice("Payment not found.");

    return;
  }

  if (payments.every((payment) => payment.status === "received" || payment.status === "paid")) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  try {
    /*
     * This endpoint must exist
     * on server.js:
     *
     * PATCH /api/payments/:id/received
     */

    for (const payment of payments) {
      if (payment.status === "received" || payment.status === "paid") continue;
      await api.markPaymentReceived(payment.id);
    }

    /*
     * Reload data from JSON
     */

    await loadData();

    /*
     * Close event modal
     */

    const modal = document.querySelector("#event-modal");

    if (modal) {
      modal.classList.remove("open");
    }

    /*
     * Re-render everything
     */

    renderDashboard();
    renderCalendar();
    renderProfitCalculator();
  } catch (error) {
    console.error("MARK PAYMENT RECEIVED ERROR:", FinoErrors.diagnostics(error));

    showNotice(error || "Failed to mark payment as received.");

    if (button) {
      button.disabled = false;

      button.textContent = "Mark as received";
    }
  }
}

function setupEventModal() {
  const modal = document.querySelector("#event-modal");

  if (!modal) {
    return;
  }

  const close = () => {
    modal.classList.remove("open");
  };

  const closeButton = document.querySelector("#close-event-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  const closeButton2 = document.querySelector("#event-modal-close-btn");

  if (closeButton2) {
    closeButton2.addEventListener("click", close);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });
}

function setupCalendarNavigation() {
  const previous = document.querySelector("#previous-month");

  const next = document.querySelector("#next-month");

  const today = document.querySelector("#today-btn");
  const moveToMonth = (year, month) => {
    const current = stateStore.selectUI('calendarDate');
    const selected = stateStore.selectUI('calendarSelectedDate');
    const day = selected ? Number(selected.slice(-2)) : current.getDate();
    const date = new Date(year, month, 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const selection = new Date(date.getFullYear(), date.getMonth(), Math.min(day, lastDay));
    stateStore.setUI({ calendarDate: date, calendarSelectedDate: getDateString(selection) });
    renderCalendar();
  };

  if (previous) {
    previous.addEventListener("click", () => {
      const date = stateStore.selectUI('calendarDate');
      moveToMonth(date.getFullYear(), date.getMonth() - 1);
    });
  }

  if (next) {
    next.addEventListener("click", () => {
      const date = stateStore.selectUI('calendarDate');
      moveToMonth(date.getFullYear(), date.getMonth() + 1);
    });
  }

  if (today) {
    today.addEventListener("click", () => {
      stateStore.setUI({ calendarDate: new Date(), calendarSelectedDate: getDateString(new Date()) });

      renderCalendar();
    });
  }
  const picker = document.querySelector('#calendar-month-picker');
  picker?.addEventListener('click', () => { try { picker.showPicker?.(); } catch (_) { /* Native input remains keyboard-accessible. */ } });
  picker?.addEventListener('change', () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(picker.value)) return;
    const [year, month] = picker.value.split('-').map(Number);
    moveToMonth(year, month - 1);
  });
  document.querySelector('#calendar-help-btn')?.addEventListener('click', () => {
    const title = document.querySelector('#event-modal-title');
    title.textContent = 'Calendar guide';
    title.setAttribute('translate', 'yes');
    document.querySelector('#event-modal-content').innerHTML = document.querySelector('#calendar-help-template').innerHTML;
    document.querySelector('#event-modal').classList.add('open');
  });
}

function populateAssetSelect() {
  const select = document.querySelector("#note-asset");

  if (!select) {
    return;
  }

  select.innerHTML = `
        <option value="">
            Select asset
        </option>
    `;

  stateStore.selectAssets().forEach((asset) => {
    const option = document.createElement("option");

    option.value = asset.id;

    option.textContent = asset.name;
    option.setAttribute("translate", "no");

    select.appendChild(option);
  });
}

function openNoteModal(date = null) {
  const modal = document.querySelector("#note-modal");

  const dateInput = document.querySelector("#note-date");

  const textInput = document.querySelector("#note-text");

  if (!modal || !dateInput || !textInput) {
    return;
  }

  populateAssetSelect();

  dateInput.value = date || getDateString(new Date());

  textInput.value = "";

  const amountInput = document.querySelector('#note-form [name="amount"]');

  if (amountInput) {
    amountInput.value = "";
  }

  modal.classList.add("open");
}

function setupNoteModal() {
  const modal = document.querySelector("#note-modal");

  if (!modal) {
    return;
  }

  const close = () => {
    modal.classList.remove("open");
  };

  const addButton = document.querySelector("#add-note-btn");

  if (addButton) {
    addButton.addEventListener("click", () => openNoteModal(stateStore.selectUI('calendarSelectedDate') || getDateString(stateStore.selectUI('calendarDate'))));
  }

  const closeButton = document.querySelector("#close-note-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  const cancelButton = document.querySelector("#cancel-note");

  if (cancelButton) {
    cancelButton.addEventListener("click", close);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  const form = document.querySelector("#note-form");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    const assetId = formData.get("assetId");

    const asset = stateStore.selectAssets().find((item) => item.id === assetId);

    const note = {
      date: formData.get("date"),

      assetId,

      assetName: asset?.name || "Planned purchase",

      text: String(formData.get("text") || "").trim(),

      amount: normalizeNumber(formData.get("amount")),

      currency: asset?.currency || "UAH",
    };

    if (!note.date || !note.assetId || !note.text) {
      showNotice("Please fill in all required fields.");

      return;
    }

    try {
      await api.createCalendarNote(financialCommand(form, 'createCalendarNote', note).body);

      close();

      await loadData();
    } catch (error) {
      console.error(FinoErrors.diagnostics(error));

      showNotice(error || "Failed to save note.");
    }
  });
}
return { markPaymentAsReceived, openNoteModal, populateAssetSelect, setupCalendarNavigation, setupEventModal, setupNoteModal };
}
