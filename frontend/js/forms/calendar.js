(function () {
const state = stateStore.getState();
// forms/calendar.js
async function markPaymentAsReceived(paymentIds, button = null) {
  const ids = Array.isArray(paymentIds) ? paymentIds : [paymentIds];
  const payments = ids.map((id) => state.data.payments.find((item) => item.id === id)).filter(Boolean);

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
    console.error("MARK PAYMENT RECEIVED ERROR:", window.FinoErrors.diagnostics(error));

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

  if (previous) {
    previous.addEventListener("click", () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);

      renderCalendar();
    });
  }

  if (next) {
    next.addEventListener("click", () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);

      renderCalendar();
    });
  }

  if (today) {
    today.addEventListener("click", () => {
      state.calendarDate = new Date();

      renderCalendar();
    });
  }
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

  state.data.assets.forEach((asset) => {
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
    addButton.addEventListener("click", () => openNoteModal());
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

    const asset = state.data.assets.find((item) => item.id === assetId);

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
      console.error(window.FinoErrors.diagnostics(error));

      showNotice(error || "Failed to save note.");
    }
  });
}
Object.assign(window, { markPaymentAsReceived, setupEventModal, setupCalendarNavigation, populateAssetSelect, openNoteModal, setupNoteModal });
})();
