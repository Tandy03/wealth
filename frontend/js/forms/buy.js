// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createFormsBuy({
  FinoErrors,
  FormData,
  api,
  console,
  document,
  financialCommand,
  loadData,
  normalizeNumber,
  showNotice,
  stateStore,
}) {
// Buy form and modal lifecycle.
function openBuyMoreModal(assetId) {
  const asset = stateStore.selectAssets()?.find((item) => item.id === assetId);

  if (!asset) {
    showNotice("Asset not found.");

    return;
  }

  const modal = document.querySelector("#buy-more-modal");

  const form = document.querySelector("#buy-more-form");

  if (!modal || !form) {
    console.warn("Buy more modal or form was not found.");

    return;
  }

  stateStore.setUI({ buyingAssetId: assetId });
  const buyQuantityInput = form.querySelector('[name="quantity"]');
  if (buyQuantityInput) {
    const supportsFractions = ["etf", "stock", "crypto_earn"].includes(asset.type);
    buyQuantityInput.step = supportsFractions ? "any" : "1";
    buyQuantityInput.min = supportsFractions ? "0.00000001" : "1";
  }

  const assetNameInput = document.querySelector("#buy-more-asset-name");

  if (assetNameInput) {
    assetNameInput.value = `${asset.name} (${asset.currency || "UAH"})`;
  }
  const currencyInput = document.querySelector("#buy-currency");
  if (currencyInput) currencyInput.value = asset.currency || "UAH";

  /*
   * Clear previous values
   */

  form.reset();

  /*
   * Restore asset name after reset
   */

  if (assetNameInput) {
    assetNameInput.value = `${asset.name} (${asset.currency || "UAH"})`;
  }
  if (currencyInput) currencyInput.value = asset.currency || "UAH";

  /*
   * Default date = today
   */

  const dateInput = document.querySelector("#buy-more-date");

  if (dateInput) {
    dateInput.value = new Date().toISOString().split("T")[0];
  }

  modal.classList.add("open");
}

function setupBuyMoreModal() {
  const modal = document.querySelector("#buy-more-modal");

  const form = document.querySelector("#buy-more-form");

  if (!modal || !form) {
    console.warn("Buy more modal or form was not found.");

    return;
  }

  form.noValidate = true;

  /*
   * ==========================================================
   * CLOSE MODAL
   * ==========================================================
   */

  const close = () => {
    modal.classList.remove("open");

    stateStore.setUI({ buyingAssetId: null });

    form.reset();
  };

  /*
   * Close button
   */

  const closeButton = document.querySelector("#close-buy-more-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  /*
   * Cancel button
   */

  const cancelButton = document.querySelector("#cancel-buy-more");

  if (cancelButton) {
    cancelButton.addEventListener("click", close);
  }

  /*
   * Click outside
   */

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  /*
   * ==========================================================
   * SUBMIT
   * ==========================================================
   */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const assetId = stateStore.selectUI('buyingAssetId');

    if (!assetId) {
      showNotice("Asset was not selected.");

      return;
    }

    const formData = new FormData(form);

    const purchase = {
      quantity: normalizeNumber(formData.get("quantity")),

      purchasePrice: normalizeNumber(formData.get("purchasePrice")),

      purchaseDate: formData.get("purchaseDate"),
    };

    /*
     * ======================================================
     * VALIDATION
     * ======================================================
     */

    if (purchase.quantity <= 0) {
      showNotice("Enter a valid quantity.");

      return;
    }

    const purchasedAsset = stateStore.selectAssets().find((asset) => asset.id === assetId);
    if (!["etf", "stock", "crypto_earn"].includes(purchasedAsset?.type) && !Number.isInteger(purchase.quantity)) {
      showNotice("Quantity must be a whole number.");

      return;
    }

    if (purchase.purchasePrice < 0) {
      showNotice("Enter a valid purchase price.");

      return;
    }

    if (!purchase.purchaseDate) {
      showNotice("Enter a purchase date.");

      return;
    }

    /*
     * ======================================================
     * SUBMIT BUTTON
     * ======================================================
     */

    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;

      submitButton.dataset.originalText = submitButton.textContent;

      submitButton.textContent = "Saving...";
    }

    try {
      /*
       * ==================================================
       * BUY MORE ASSET
       * ==================================================
       */

      await api.buyMoreAsset(assetId, financialCommand(form, 'buyMoreAsset', purchase, assetId).body);

      /*
       * Close modal
       */

      close();

      /*
       * Reload application data
       */

      await loadData();
    } catch (error) {
      console.error("BUY MORE ASSET ERROR:", FinoErrors.diagnostics(error));

      showNotice(error || "Failed to buy more asset.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent =
          submitButton.dataset.originalText || "Докупити";
      }
    }
  });
}
return { openBuyMoreModal, setupBuyMoreModal };
}
