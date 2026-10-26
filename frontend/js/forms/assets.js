// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createFormsAssets({
  DEFAULT_INSTRUMENTS,
  FinoErrors,
  FinoI18n,
  FinoOperations,
  FormData,
  api,
  console,
  document,
  escapeHtml,
  financialCommand,
  getAvailableQuantity,
  getCurrentPrice,
  getDateString,
  groupHoldingsByInstrument,
  holdingGroupLabel,
  loadData,
  normalizeNumber,
  openBuyMoreModal,
  renderAssetTransactionsModal,
  showConfirm,
  showNotice,
  stateStore,
}) {
// forms/assets.js
function populateInstrumentSelect(selectedName = "") {
  const select = document.querySelector("#asset-instrument");
  if (!select) return;
  const instruments = [...DEFAULT_INSTRUMENTS, ...(stateStore.selectInstruments() || [])]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.name.toLowerCase() === item.name.toLowerCase()) === index);
  select.innerHTML = instruments.map((item) => `<option translate="no" value="${escapeHtml(item.name)}" data-instrument-type="${escapeHtml(item.type)}">${escapeHtml(item.name)} — ${escapeHtml(FinoI18n.t(item.type))}</option>`).join("") + '<option value="__new__">New instrument...</option>';
  if (selectedName && instruments.some((item) => item.name === selectedName)) select.value = selectedName;
  updateNewInstrumentFields();
}

function updateNewInstrumentFields() {
  const isNew = document.querySelector("#asset-instrument")?.value === "__new__";
  const nameField = document.querySelector("#new-instrument-name-field");
  const typeField = document.querySelector("#new-instrument-type-field");
  if (nameField) nameField.hidden = !isNew;
  if (typeField) typeField.hidden = !isNew;
}

function openAssetTransactions(assetIds) {
  stateStore.setUI({ assetDetailIds: assetIds });
  const assets = stateStore.selectAssets().filter((asset) => assetIds.includes(asset.id));
  document.querySelector("#asset-transactions-title").textContent = assets[0]?.name || "Transactions";
  document.querySelector("#asset-transactions-title").setAttribute("translate", assets[0]?.name ? "no" : "yes");
  document.querySelector("#asset-hide-sales").checked = false;
  document.querySelector("#asset-only-current").checked = false;
  renderAssetTransactionsModal();
  document.querySelector("#asset-transactions-modal").classList.add("open");
}

function setupAssetTransactionsModal() {
  const modal = document.querySelector("#asset-transactions-modal");
  document.querySelector("#close-asset-transactions")?.addEventListener("click", () => modal?.classList.remove("open"));
  document.querySelector("#asset-hide-sales")?.addEventListener("change", () => renderAssetTransactionsModal());
  document.querySelector("#asset-only-current")?.addEventListener("change", () => renderAssetTransactionsModal());
}

async function executeHoldingAction(assetIds, action) {
  const assets = stateStore.selectAssets().filter((asset) => assetIds.includes(asset.id));
  if (!assets.length) return showNotice("Holding not found.");
  if (action === "buy") {
    openBuyMoreModal(assets[0].id);
    return;
  }
  if (action === "edit") {
    openEditAssetModal(assets.map((asset) => asset.id));
    return;
  }
  const group = groupHoldingsByInstrument(assets)[0];
  const confirmed = await showConfirm(
    `Delete ${holdingGroupLabel(group)} and all related payments, transactions and sales?`,
    "Confirm deletion",
  );
  if (!confirmed) return;
  try {
    for (const asset of assets) await api.deleteAsset(asset.id);
    await loadData();
  } catch (error) {
    console.error(FinoErrors.diagnostics(error));
    showNotice(error || "Failed to delete holding.");
  }
}

function openHoldingSelectionModal(assetIds, action) {
  const holdings = stateStore.selectAssets().filter((asset) => assetIds.includes(asset.id) && getAvailableQuantity(asset.id) > 0);
  if (!holdings.length) return showNotice("No available holdings found.");
  const instrumentGroups = groupHoldingsByInstrument(holdings);
  if (instrumentGroups.length === 1) {
    executeHoldingAction(instrumentGroups[0].assets.map((asset) => asset.id), action);
    return;
  }
  const modal = document.querySelector("#delete-holding-modal");
  const select = document.querySelector("#delete-holding-asset");
  if (!modal || !select) return;
  stateStore.setUI({ holdingSelectionAction: action });
  select.innerHTML = instrumentGroups.map((group) => `<option translate="no" value="${escapeHtml(group.assets.map((asset) => asset.id).join(","))}">${escapeHtml(holdingGroupLabel(group))}</option>`).join("");
  document.querySelector("#holding-selection-title").textContent = action === "buy" ? "Buy holding" : action === "edit" ? "Edit holding" : "Delete holding";
  const submit = document.querySelector("#holding-selection-submit");
  submit.textContent = action === "buy" ? "Buy" : action === "edit" ? "Edit" : "Delete";
  submit.className = action === "delete" ? "danger-btn" : "primary-btn";
  modal.classList.add("open");
}

function setupDeleteHoldingModal() {
  const modal = document.querySelector("#delete-holding-modal");
  const form = document.querySelector("#delete-holding-form");
  const close = () => modal?.classList.remove("open");
  document.querySelector("#close-delete-holding-modal")?.addEventListener("click", close);
  document.querySelector("#cancel-delete-holding")?.addEventListener("click", close);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const assetIds = String(document.querySelector("#delete-holding-asset")?.value || "").split(",").filter(Boolean);
    if (!assetIds.length) return showNotice("Please select a holding.");
    close();
    await executeHoldingAction(assetIds, stateStore.selectUI('holdingSelectionAction'));
  });
}

function openEditAssetModal(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const assets = stateStore.selectAssets().filter((item) => ids.includes(item.id));
  const firstAsset = assets[0];
  const totalQuantity = assets.reduce((sum, item) => sum + normalizeNumber(item.quantity), 0);
  const totalCost = assets.reduce((sum, item) => sum + normalizeNumber(item.quantity) * normalizeNumber(item.purchasePrice), 0);
  const totalCurrentValue = assets.reduce((sum, item) => sum + normalizeNumber(item.quantity) * getCurrentPrice(item), 0);
  const asset = firstAsset && assets.length > 1 ? {
    ...firstAsset,
    quantity: totalQuantity,
    purchasePrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
    currentPrice: totalQuantity > 0 ? totalCurrentValue / totalQuantity : firstAsset.currentPrice,
    purchaseDate: assets.map((item) => item.purchaseDate).filter(Boolean).sort()[0] || firstAsset.purchaseDate,
    firstDividendDate: assets.map((item) => item.firstDividendDate).filter(Boolean).sort()[0] || firstAsset.firstDividendDate,
  } : firstAsset;

  if (!asset) {
    showNotice("Asset not found.");
    return;
  }

  const modal = document.querySelector("#asset-modal");

  const form = document.querySelector("#asset-form");

  if (!modal || !form) {
    return;
  }

  stateStore.setUI({ editingAssetId: asset.id });
  stateStore.setUI({ editingAssetIds: assets.map((item) => item.id) });

  /*
   * Modal title
   */

  const modalTitle = modal.querySelector(".modal-header h2");

  if (modalTitle) {
    modalTitle.textContent = "Edit asset";
  }

  /*
   * Submit button
   */

  const submitButton = form.querySelector('button[type="submit"]');

  if (submitButton) {
    submitButton.textContent = "Save changes";
  }

  /*
   * Basic fields
   */

  form.elements.name.value = asset.name || "";

  form.elements.type.value = asset.type || "ovdp";

  form.elements.currency.value = asset.currency || "UAH";

  form.elements.quantity.value = asset.quantity ?? "";

  form.elements.purchasePrice.value = asset.purchasePrice ?? "";

  form.elements.purchaseDate.value = asset.purchaseDate || "";
  populateInstrumentSelect(asset.instrumentName || "");
  if (form.elements.termMonths) form.elements.termMonths.value = asset.termMonths || 1;
  if (form.elements.novapayMaturityDate) form.elements.novapayMaturityDate.value = asset.type === "novapay" ? asset.maturityDate || "" : "";
  if (form.elements.maturityAmount) form.elements.maturityAmount.value = asset.maturityAmount || "";
  if (form.elements.annualRate) form.elements.annualRate.value = asset.annualRate ?? "";
  if (form.elements.cryptoEarnApr) form.elements.cryptoEarnApr.value = asset.type === "crypto_earn" ? asset.annualRate ?? "" : "";
  if (form.elements.depositMaturityDate) form.elements.depositMaturityDate.value = asset.type === "deposit" ? asset.maturityDate || "" : "";
  if (form.elements.earlyWithdrawal) form.elements.earlyWithdrawal.checked = Boolean(asset.earlyWithdrawal);

  /*
   * Update visible settings
   */

  updateAssetTypeFields();

  /*
   * REIT
   */

  const dividendInput = document.querySelector("#dividend-per-unit");

  const firstDividendInput = document.querySelector("#first-dividend-date");

  const s1CurrentPriceField = document.querySelector("#s1-current-price-field");

  const currentPriceInput = document.querySelector("#s1-current-price");

  if (dividendInput) {
    dividendInput.value = asset.dividendPerUnit ?? "";
  }

  if (firstDividendInput) {
    firstDividendInput.value = asset.firstDividendDate || "";
  }

  if (currentPriceInput) {
    currentPriceInput.value = asset.currentPrice ?? "";
  }

  /*
   * OVDP
   */

  const maturityInput = document.querySelector("#maturity-date");
  const isinInput = document.querySelector("#asset-isin");

  if (maturityInput) {
    maturityInput.value = asset.maturityDate || "";
  }

  if (isinInput) {
    isinInput.value = asset.isin || "";
  }

  const couponList = document.querySelector("#coupon-list");

  if (couponList) {
    couponList.innerHTML = "";

    if (asset.type === "ovdp" && Array.isArray(asset.coupons)) {
      asset.coupons.forEach((coupon) => {
        addCouponRow(coupon);
      });
    }
  }

  modal.classList.add("open");
}

function setupModal() {
  const modal = document.querySelector("#asset-modal");

  const form = document.querySelector("#asset-form");

  /*
   * Never allow a missing modal
   * to crash the whole application.
   */

  if (!modal || !form) {
    console.warn("Asset modal or form was not found.");

    return;
  }

  /*
   * We handle validation ourselves.
   * This prevents hidden fields from
   * blocking submit.
   */

  form.noValidate = true;
  populateInstrumentSelect();
  document.querySelector("#asset-instrument")?.addEventListener("change", updateNewInstrumentFields);
  const updateNovaPayDate = () => {
    if (form.elements.type?.value !== "novapay" || !form.elements.purchaseDate?.value) return;
    const date = new Date(`${form.elements.purchaseDate.value}T00:00:00`);
    date.setMonth(date.getMonth() + Math.max(1, normalizeNumber(form.elements.termMonths?.value)));
    form.elements.novapayMaturityDate.value = getDateString(date);
  };
  form.elements.termMonths?.addEventListener("input", updateNovaPayDate);
  form.elements.purchaseDate?.addEventListener("change", updateNovaPayDate);

  /*
   * ==========================================================
   * HELPERS
   * ==========================================================
   */

  const getInput = (name) => form.querySelector(`[name="${name}"]`);

  const setValue = (name, value) => {
    const input = getInput(name);

    if (input) {
      input.value = value ?? "";
    }
  };

  const setModalMode = (mode) => {
    const modalTitle = modal.querySelector(".modal-header h2");

    const submitButton = form.querySelector('button[type="submit"]');

    if (mode === "edit") {
      if (modalTitle) {
        modalTitle.textContent = "Edit asset";
      }

      if (submitButton) {
        submitButton.textContent = "Save changes";
      }
    } else {
      if (modalTitle) {
        modalTitle.textContent = "Add asset";
      }

      if (submitButton) {
        submitButton.textContent = "Save asset";
      }
    }
  };

  /*
   * Clear coupon rows.
   */

  const clearCoupons = () => {
    const couponList = document.querySelector("#coupon-list");

    if (couponList) {
      couponList.innerHTML = "";
    }
  };

  /*
   * Reset the complete form.
   */

  const resetAssetForm = () => {
    form.reset();
    populateInstrumentSelect();

    clearCoupons();

    /*
     * Reset editing state.
     */

    stateStore.setUI({ editingAssetId: null });
    stateStore.setUI({ editingAssetIds: [] });

    setModalMode("add");

    /*
     * Update dynamic fields
     * according to default type.
     */

    updateAssetTypeFields();

    /*
     * Set default dates.
     */

    setDefaultDates();

    /*
     * If default type is OVDP,
     * create the first coupon row.
     */

    const currentType = getInput("type")?.value;

    if (currentType === "ovdp") {
      addCouponRow();
    }
  };

  /*
   * ==========================================================
   * OPEN ADD MODAL
   * ==========================================================
   */

  const openAddModal = () => {
    /*
     * Make sure no previous
     * editing state remains.
     */

    stateStore.setUI({ editingAssetId: null });
    stateStore.setUI({ editingAssetIds: [] });

    /*
     * Completely reset form.
     */

    form.reset();
    populateInstrumentSelect();

    clearCoupons();

    setModalMode("add");

    /*
     * Update fields first.
     */

    updateAssetTypeFields();

    /*
     * Set default dates.
     */

    setDefaultDates();

    /*
     * Add first coupon
     * for OVDP.
     */

    const currentType = getInput("type")?.value;

    if (currentType === "ovdp") {
      addCouponRow();
    }

    /*
     * Open modal.
     */

    modal.classList.add("open");
  };

  /*
   * ==========================================================
   * OPEN EDIT MODAL
   * ==========================================================
   */

  const openEditModal = (asset) => {
    if (!asset) {
      console.warn("Cannot edit missing asset.");

      return;
    }

    /*
     * Store ID of asset being edited.
     */

    stateStore.setUI({ editingAssetId: asset.id });

    /*
     * Reset form before
     * filling existing data.
     */

    form.reset();

    clearCoupons();

    /*
     * Change modal title
     * and submit button.
     */

    setModalMode("edit");

    /*
     * ======================================================
     * BASIC DATA
     * ======================================================
     */

    setValue("name", asset.name);

    setValue("type", asset.type);

    setValue("currency", asset.currency || "UAH");

    setValue("quantity", asset.quantity);

    setValue("purchasePrice", asset.purchasePrice);

    setValue("purchaseDate", asset.purchaseDate);

    /*
     * Update dynamic fields
     * after setting asset type.
     */

    updateAssetTypeFields();

    /*
     * ======================================================
     * REIT
     * ======================================================
     */

    if (asset.type === "inzhur_reit" || asset.type === "s1_reit") {
      setValue("dividendPerUnit", asset.dividendPerUnit);

      setValue("firstDividendDate", asset.firstDividendDate);
    }

    /*
     * ======================================================
     * OVDP
     * ======================================================
     */

    if (asset.type === "ovdp") {
      setValue("maturityDate", asset.maturityDate);

      /*
       * Recreate all coupon rows
       * from saved data.
       */

      const coupons = Array.isArray(asset.coupons) ? asset.coupons : [];

      if (coupons.length) {
        coupons.forEach((coupon) => {
          addCouponRow(coupon);
        });
      } else {
        /*
         * If old asset has no coupons,
         * create one empty row.
         */

        addCouponRow();
      }
    }

    /*
     * ======================================================
     * OPEN MODAL
     * ======================================================
     */

    modal.classList.add("open");
  };

  /*
   * ==========================================================
   * CLOSE MODAL
   * ==========================================================
   */

  const close = () => {
    modal.classList.remove("open");
  };

  /*
   * ==========================================================
   * HEADER ADD ASSET
   * ==========================================================
   */

  const addButton = document.querySelector("#add-asset-btn");

  if (addButton) {
    addButton.addEventListener("click", (event) => {
      event.preventDefault();

      openAddModal();
    });
  }

  /*
   * ==========================================================
   * PORTFOLIO ADD ASSET
   * ==========================================================
   */

  /*
   * ==========================================================
   * CLOSE BUTTON
   * ==========================================================
   */

  const closeButton = document.querySelector("#close-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  /*
   * ==========================================================
   * CANCEL BUTTON
   * ==========================================================
   */

  const cancelButton = document.querySelector("#cancel-modal");

  if (cancelButton) {
    cancelButton.addEventListener("click", close);
  }

  /*
   * ==========================================================
   * CLICK OUTSIDE MODAL
   * ==========================================================
   */

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  /*
   * ==========================================================
   * ASSET TYPE
   * ==========================================================
   */

  const assetType = document.querySelector("#asset-type");

  if (assetType) {
    assetType.addEventListener("change", () => {
      updateAssetTypeFields();
      updateNovaPayDate();

      /*
       * When switching to OVDP
       * during Add/Edit, make sure
       * there is at least one coupon row.
       */

      if (assetType.value === "ovdp") {
        const couponList = document.querySelector("#coupon-list");

        if (couponList && !couponList.children.length) {
          addCouponRow();
        }
      }
    });
  }

  /*
   * ==========================================================
   * ADD COUPON
   * ==========================================================
   */

  const addCouponButton = document.querySelector("#add-coupon-btn");

  if (addCouponButton) {
    addCouponButton.addEventListener("click", addCouponRow);
  }

  /*
   * ==========================================================
   * SUBMIT
   * ==========================================================
   */

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    const type = formData.get("type");

    /*
     * ======================================================
     * BASIC ASSET DATA
     * ======================================================
     */

    const asset = {
      name: String(formData.get("name") || "").trim(),

      type,

      currency: formData.get("currency") || "UAH",

      quantity: normalizeNumber(formData.get("quantity")),

      purchasePrice: normalizeNumber(formData.get("purchasePrice")),

      purchaseDate: formData.get("purchaseDate"),

      isin: String(formData.get("isin") || "").trim().toUpperCase(),
    };
    const instrumentSelect = document.querySelector("#asset-instrument");
    const isNewInstrument = instrumentSelect?.value === "__new__";
    asset.instrumentName = isNewInstrument ? String(formData.get("newInstrumentName") || "").trim() : instrumentSelect?.value || "";
    asset.instrumentType = isNewInstrument ? String(formData.get("newInstrumentType") || "").trim() : instrumentSelect?.selectedOptions?.[0]?.dataset.instrumentType || "";
    asset.isNewInstrument = isNewInstrument;

    if (type === "s1_reit" && formData.get("currentPrice") !== "") {
      asset.currentPrice = normalizeNumber(formData.get("currentPrice"));
    }

    if (["etf", "stock"].includes(type)) {
      asset.ticker = String(formData.get("ticker") || "").trim().toUpperCase();
      asset.currentPrice = normalizeNumber(formData.get("marketCurrentPrice"));
    }

    /*
     * ======================================================
     * REIT
     * ======================================================
     */

    if (type === "inzhur_reit" || type === "s1_reit") {
      asset.paymentMethod = "monthly_dividend";

      asset.dividendPerUnit = normalizeNumber(formData.get("dividendPerUnit"));

      asset.firstDividendDate = formData.get("firstDividendDate");

      if (asset.dividendPerUnit <= 0) {
        showNotice("Enter dividend per unit.");

        return;
      }

      if (!asset.firstDividendDate) {
        showNotice("Enter first dividend date.");

        return;
      }
    }

    /*
     * ======================================================
     * OVDP
     * ======================================================
     */

    if (type === "ovdp") {
      asset.paymentMethod = "coupons";

      asset.maturityDate = formData.get("maturityDate");
      asset.redemptionValue = normalizeNumber(formData.get("redemptionValue")) || 1000;

      asset.coupons = collectCoupons();

      if (!asset.maturityDate) {
        showNotice("Enter maturity date.");

        return;
      }

      if (!asset.coupons.length) {
        showNotice("Add at least one coupon.");

        return;
      }
    }

    /*
     * ======================================================
     * MILTECH
     * ======================================================
     */

    if (type === "inzhur_miltech") {
      asset.paymentMethod = "capitalization";
    }

    if (type === "savings") asset.paymentMethod = "none";
    if (type === "novapay") {
      asset.termMonths = normalizeNumber(formData.get("termMonths"));
      asset.maturityDate = formData.get("novapayMaturityDate");
      asset.maturityAmount = normalizeNumber(formData.get("maturityAmount"));
    }
    if (type === "deposit") {
      asset.annualRate = normalizeNumber(formData.get("annualRate"));
      asset.maturityDate = formData.get("depositMaturityDate");
      asset.earlyWithdrawal = formData.get("earlyWithdrawal") === "on";
    }
    if (type === "crypto_earn") {
      asset.ticker = asset.name.toUpperCase();
      asset.annualRate = normalizeNumber(formData.get("cryptoEarnApr"));
      asset.currentPrice = asset.purchasePrice;
      asset.paymentMethod = "crypto_earn";
      if (asset.annualRate <= 0) {
        showNotice("Enter a valid APR.");
        return;
      }
    }

    /*
     * ======================================================
     * BASIC VALIDATION
     * ======================================================
     */

    if (
      !asset.name ||
      !asset.type ||
      asset.quantity <= 0 ||
      asset.purchasePrice < 0 ||
      !asset.purchaseDate
    ) {
      showNotice("Please enter valid asset data.");

      return;
    }

    if (!["etf", "stock", "crypto_earn"].includes(asset.type) && !Number.isInteger(asset.quantity)) {
      showNotice("Quantity must be a whole number.");

      return;
    }

    /*
     * ======================================================
     * SUBMIT BUTTON
     * ======================================================
     */

    const submitButton = form.querySelector('button[type="submit"]');

    let originalText = "Save asset";

    if (submitButton) {
      originalText = submitButton.textContent;

      submitButton.disabled = true;

      submitButton.textContent = stateStore.selectUI('editingAssetId')
        ? "Saving changes..."
        : "Saving...";
    }

    /*
     * ======================================================
     * SAVE
     * ======================================================
     */

    try {
      if (stateStore.selectUI('editingAssetId')) {
        /*
         * EDIT EXISTING ASSET
         */

        if (stateStore.selectUI('editingAssetIds').length > 1) {
          const command = financialCommand(form, 'mergeAssets', { assetIds: stateStore.selectUI('editingAssetIds') });
          const merged = await api.mergeAssets(command.body.assetIds, { operationId: command.body.operationId });
          stateStore.setUI({ editingAssetId: merged.id });
        }
        await api.updateAsset(stateStore.selectUI('editingAssetId'), asset);
      } else {
        /*
         * CREATE NEW ASSET
         */
        const identity = (item) => [
          item.type,
          item.name,
          item.instrumentName || "",
          item.instrumentType || "",
          item.currency || "UAH",
        ].map((value) => String(value).trim().toLocaleLowerCase()).join("::");
        const existingAsset = stateStore.selectAssets().find((item) => identity(item) === identity(asset));
        const body = existingAsset ? {
            quantity: asset.quantity,
            purchasePrice: asset.purchasePrice,
            purchaseDate: asset.purchaseDate,
            currency: asset.currency,
            instrumentId: existingAsset.instrumentId,
          } : asset;
        const intent = FinoOperations.describe('createAsset', [{ ...asset, operationId: 'preview' }]).command;
        const command = financialCommand(form, existingAsset ? 'buyMoreAsset' : 'createAsset', body, existingAsset?.id || null,
          { slot: 'asset-acquisition', identity: intent });
        if (command.method === 'buyMoreAsset') await api.buyMoreAsset(command.target, command.body);
        else await api.createAsset(command.body);
      }

      /*
       * Reset form/state.
       */

      form.reset();

      clearCoupons();

      stateStore.setUI({ editingAssetId: null });
      stateStore.setUI({ editingAssetIds: [] });

      setModalMode("add");

      /*
       * Close modal.
       */

      close();

      /*
       * Reload all data.
       */

      await loadData();
    } catch (error) {
      console.error("SAVE ASSET ERROR:", FinoErrors.diagnostics(error));

      showNotice(error || "Failed to save asset.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent = originalText;
      }
    }
  });

  /*
   * ==========================================================
   * INITIAL STATE
   * ==========================================================
   */

  stateStore.setUI({ editingAssetId: null });
  stateStore.setUI({ editingAssetIds: [] });

  setModalMode("add");
}

function updateAssetTypeFields() {
  const typeElement = document.querySelector("#asset-type");

  const reitSettings = document.querySelector("#reit-settings");

  const ovdpSettings = document.querySelector("#ovdp-settings");

  const capitalizationSettings = document.querySelector(
    "#capitalization-settings",
  );
  const novapaySettings = document.querySelector("#novapay-settings");
  const depositSettings = document.querySelector("#deposit-settings");
  const cryptoEarnSettings = document.querySelector("#crypto-earn-settings");

  const dividendInput = document.querySelector("#dividend-per-unit");

  const firstDividendInput = document.querySelector("#first-dividend-date");

  const maturityInput = document.querySelector("#maturity-date");

  const s1CurrentPriceField = document.querySelector("#s1-current-price-field");
  const marketTickerField = document.querySelector("#market-ticker-field");
  const marketCurrentPriceField = document.querySelector("#market-current-price-field");
  const assetNameLabel = document.querySelector("#asset-name-label");
  const assetNameInput = document.querySelector("#asset-name");
  const cryptoEarnAprInput = document.querySelector('[name="cryptoEarnApr"]');

  const couponInputs = document.querySelectorAll(
    ".coupon-date, .coupon-amount",
  );

  if (!typeElement) {
    return;
  }

  const type = typeElement.value;
  if (assetNameLabel) assetNameLabel.textContent = type === "crypto_earn" ? "Ticker / asset name" : "Asset name";
  if (assetNameInput) assetNameInput.placeholder = type === "crypto_earn" ? "e.g. USDT or BTC" : "e.g. OVDP 236624";
  if (cryptoEarnAprInput) cryptoEarnAprInput.required = type === "crypto_earn";
  const quantityInput = document.querySelector('#asset-form [name="quantity"]');
  if (quantityInput) {
    quantityInput.step = ["etf", "stock", "crypto_earn"].includes(type) ? "any" : "1";
    quantityInput.min = ["etf", "stock", "crypto_earn"].includes(type) ? "0.00000001" : "1";
  }

  /*
   * Hide all dynamic sections
   */
  [reitSettings, ovdpSettings, capitalizationSettings, novapaySettings, depositSettings, cryptoEarnSettings]
    .filter(Boolean)
    .forEach((element) => {
      element.classList.remove("visible");
    });

  if (s1CurrentPriceField) {
    s1CurrentPriceField.hidden = true;
  }

  if (marketTickerField) marketTickerField.hidden = !["etf", "stock"].includes(type);
  if (marketCurrentPriceField) marketCurrentPriceField.hidden = !["etf", "stock"].includes(type);

  /*
   * ==========================================================
   * RESET REQUIRED STATE
   * ==========================================================
   */

  if (dividendInput) {
    dividendInput.required = false;
  }

  if (firstDividendInput) {
    firstDividendInput.required = false;
  }

  if (maturityInput) {
    maturityInput.required = false;
  }

  couponInputs.forEach((input) => {
    input.required = false;
  });

  /*
   * ==========================================================
   * REIT
   * ==========================================================
   */

  if (type === "inzhur_reit" || type === "s1_reit") {
    reitSettings?.classList.add("visible");

    if (s1CurrentPriceField) {
      s1CurrentPriceField.hidden = type !== "s1_reit";
    }

    if (dividendInput) {
      dividendInput.required = true;
    }

    if (firstDividendInput) {
      firstDividendInput.required = true;
    }

    /*
     * Coupon fields are NOT required for REIT.
     */
    couponInputs.forEach((input) => {
      input.required = false;
    });

    return;
  }

  /*
   * ==========================================================
   * OVDP
   * ==========================================================
   */

  if (type === "ovdp") {
    ovdpSettings?.classList.add("visible");

    if (maturityInput) {
      maturityInput.required = true;
    }

    /*
     * Coupon fields are required for OVDP.
     */
    couponInputs.forEach((input) => {
      input.required = true;
    });

    return;
  }

  /*
   * ==========================================================
   * MILTECH
   * ==========================================================
   */

  if (type === "inzhur_miltech") {
    capitalizationSettings?.classList.add("visible");

    return;
  }
  if (type === "novapay") novapaySettings?.classList.add("visible");
  if (type === "deposit") depositSettings?.classList.add("visible");
  if (type === "crypto_earn") cryptoEarnSettings?.classList.add("visible");
}

function addCouponRow(coupon = {}) {
  const container = document.querySelector("#coupon-list");

  if (!container) {
    return;
  }

  const row = document.createElement("div");

  row.className = "coupon-row";

  const couponDate = coupon.date || "";

  const couponAmount = coupon.amountPerUnit ?? "";

  row.innerHTML = `
        <label>
            <span>
                Coupon date
            </span>

            <input
                type="date"
                class="coupon-date"
                value="${couponDate}"
            />
        </label>

        <label>
            <span>
                Amount per unit
            </span>

            <input
                type="number"
                class="coupon-amount"
                min="0"
                step="0.000001"
                placeholder="85.50"
                value="${couponAmount}"
            />
        </label>

        <button
            type="button"
            class="remove-coupon"
        >
            Remove
        </button>
    `;

  const removeButton = row.querySelector(".remove-coupon");

  if (removeButton) {
    removeButton.addEventListener("click", () => {
      row.remove();

      updateAssetTypeFields();
    });
  }

  container.appendChild(row);

  /*
   * Apply required fields
   * depending on asset type.
   */

  updateAssetTypeFields();
}

function collectCoupons() {
  const rows = document.querySelectorAll(".coupon-row");

  return Array.from(rows)
    .map((row) => ({
      date: row.querySelector(".coupon-date")?.value,

      amountPerUnit: normalizeNumber(
        row.querySelector(".coupon-amount")?.value,
      ),
    }))
    .filter((coupon) => coupon.date && coupon.amountPerUnit > 0);
}

function setDefaultDates() {
  const today = getDateString(new Date());

  const purchaseDate = document.querySelector('[name="purchaseDate"]');

  const firstDividendDate = document.querySelector("#first-dividend-date");

  const maturityDate = document.querySelector("#maturity-date");

  if (purchaseDate && !purchaseDate.value) {
    purchaseDate.value = today;
  }

  if (firstDividendDate && !firstDividendDate.value) {
    firstDividendDate.value = today;
  }

  /*
   * Maturity remains empty
   * because it is asset-specific.
   */

  if (maturityDate && maturityDate.value === undefined) {
    maturityDate.value = "";
  }
}
return { addCouponRow, collectCoupons, executeHoldingAction, openAssetTransactions, openEditAssetModal, openHoldingSelectionModal, populateInstrumentSelect, setDefaultDates, setupAssetTransactionsModal, setupDeleteHoldingModal, setupModal, updateAssetTypeFields, updateNewInstrumentFields };
}
