(function () {
const state = stateStore.getState();
// forms/sales.js
function populateSellAssetSelect() {
  const select = document.querySelector("#sell-asset");

  if (!select) {
    return;
  }

  select.innerHTML = `
        <option value="">
            Select asset
        </option>
    `;

  const groups = Object.values(state.data.assets.reduce((result, asset) => {
    const available = getAvailableQuantity(asset.id);
    if (available <= 0 || asset.type === "novapay" || (asset.type === "deposit" && !asset.earlyWithdrawal)) return result;
    const key = `${asset.type}::${String(asset.name).trim().toLowerCase()}::${String(asset.currency || "UAH").toUpperCase()}`;
    result[key] ||= [];
    result[key].push(asset);
    return result;
  }, {}));

  groups.forEach((assets) => {
    const option = document.createElement("option");
    const first = assets[0];
    const available = assets.reduce((sum, asset) => sum + getAvailableQuantity(asset.id), 0);
    const instruments = [...new Set(assets.map((asset) => asset.instrumentName || "No instrument"))];
    const instrument = instruments.length === 1 ? instruments[0] : `${instruments.length} instruments`;
    option.value = assets.map((asset) => asset.id).join(",");
    option.setAttribute("translate", "no");
    option.textContent = `${first.name} — ${instrument} — ${window.FinoI18n.t(`${formatQuantity(available)} units`)}`;
    select.appendChild(option);
  });
}

function getSelectedSellAssets() {
  const ids = String(document.querySelector("#sell-asset")?.value || "").split(",").filter(Boolean);
  return state.data.assets
    .filter((asset) => ids.includes(asset.id))
    .sort((a, b) => String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || "")));
}

function updateSalePreview() {
  const assetSelect = document.querySelector("#sell-asset");

  const quantityInput = document.querySelector("#sell-quantity");

  const priceInput = document.querySelector("#sell-price");

  if (!assetSelect || !quantityInput || !priceInput) {
    return;
  }

  const quantity = normalizeNumber(quantityInput.value);

  const price = normalizeNumber(priceInput.value);

  const assets = getSelectedSellAssets();
  const asset = assets[0];

  const currency = asset?.currency || "UAH";

  /*
   * Support both old and
   * current HTML selectors.
   */

  const purchasePriceElement = document.querySelector("#sell-purchase-price");

  const costElement =
    document.querySelector("#sell-cost-basis") ||
    document.querySelector("#sale-cost");

  const proceedsElement =
    document.querySelector("#sell-proceeds") ||
    document.querySelector("#sale-proceeds");

  const profitElement =
    document.querySelector("#sell-profit") ||
    document.querySelector("#sale-profit");

  const roiElement =
    document.querySelector("#sell-roi") || document.querySelector("#sale-roi");

  if (!asset) {
    if (purchasePriceElement) {
      purchasePriceElement.textContent = money(0, currency);
    }

    if (costElement) {
      costElement.textContent = money(0, currency);
    }

    if (proceedsElement) {
      proceedsElement.textContent = money(0, currency);
    }

    if (profitElement) {
      profitElement.textContent = money(0, currency);
    }

    if (roiElement) {
      roiElement.textContent = "0%";
    }

    return;
  }

  const cost = getGroupedSaleCost(assets, quantity);
  const purchasePrice = quantity > 0 ? cost / quantity : assets.reduce((sum, item) => {
    const available = getAvailableQuantity(item.id);
    return sum + available * normalizeNumber(item.purchasePrice);
  }, 0) / Math.max(assets.reduce((sum, item) => sum + getAvailableQuantity(item.id), 0), 1);

  const proceeds = quantity * price;

  const profit = proceeds - cost;

  const roi = cost > 0 ? (profit / cost) * 100 : 0;

  if (purchasePriceElement) {
    purchasePriceElement.textContent = money(purchasePrice, currency);
  }

  if (costElement) {
    costElement.textContent = money(cost, currency);
  }

  if (proceedsElement) {
    proceedsElement.textContent = money(proceeds, currency);
  }

  if (profitElement) {
    profitElement.textContent = money(profit, currency);
  }

  if (roiElement) {
    roiElement.textContent = `${roi.toFixed(2)}%`;
  }
}

function openSellAssetModal(assetId = null) {
  populateSellAssetSelect();
  const select = document.querySelector('#sell-asset'), modal = document.querySelector('#sell-modal');
  if (!select || !modal) return;
  if (assetId) {
    const ids = Array.isArray(assetId) ? assetId : [assetId];
    const assets = state.data.assets.filter(item => ids.includes(item.id) && getAvailableQuantity(item.id) > 0 && item.type !== 'novapay' && (item.type !== 'deposit' || item.earlyWithdrawal));
    if (!assets.length) return;
    // Existing sale commands require a single currency; let the existing select
    // choose that currency when the displayed card spans several currencies.
    const value = new Set(assets.map(asset => asset.currency || 'UAH')).size === 1 ? assets.map(asset => asset.id).join(',') : '';
    let option = [...select.options].find(item => item.value === value);
    if (!option) { option = document.createElement('option'); option.value = value; option.textContent = assets[0].name; option.setAttribute('translate', 'no'); select.append(option); }
    select.value = value;
  }
  const date = document.querySelector('#sell-date'); if (date) date.value = getDateString(new Date());
  const quantity = document.querySelector('#sell-quantity'); if (quantity) quantity.value = '';
  const price = document.querySelector('#sell-price'); if (price) price.value = '';
  const available = document.querySelector('#sell-available'); if (available) available.value = '0';
  updateSalePreview(); modal.classList.add('open');
}
function setupSellModal() {
  const modal = document.querySelector("#sell-modal");

  const form = document.querySelector("#sell-form");

  const openButtons = document.querySelectorAll("#sell-asset-btn, #portfolio-sell-btn");

  /*
   * Do not crash application
   * if selling HTML is missing.
   */

  if (!modal || !form || !openButtons.length) {
    return;
  }

  const close = () => {
    modal.classList.remove("open");
  };

  openButtons.forEach((openButton) => openButton.addEventListener("click", (event) => {
    event.preventDefault();
    openSellAssetModal();
  }));

  const closeButton = document.querySelector("#close-sell-modal");

  if (closeButton) {
    closeButton.addEventListener("click", close);
  }

  /*
   * IMPORTANT:
   *
   * Your current HTML uses
   * #cancel-sell-modal.
   *
   * The previous app.js used
   * #cancel-sell.
   *
   * Support BOTH.
   */

  const cancelButton =
    document.querySelector("#cancel-sell-modal") ||
    document.querySelector("#cancel-sell");

  if (cancelButton) {
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();

      close();
    });
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      close();
    }
  });

  const assetSelect = document.querySelector("#sell-asset");

  if (assetSelect) {
    assetSelect.addEventListener("change", () => {
      const assets = getSelectedSellAssets();
      const available = assets.reduce((sum, asset) => sum + getAvailableQuantity(asset.id), 0);
      const asset = assets[0];
      const sellQuantityInput = document.querySelector("#sell-quantity");
      if (sellQuantityInput) sellQuantityInput.step = ["etf", "stock", "crypto_earn"].includes(asset?.type) ? "any" : "1";

      const availableInput = document.querySelector("#sell-available");

      if (availableInput) {
        availableInput.value = asset ? String(available) : "0";
      }

      updateSalePreview();
    });
  }

  const quantityInput = document.querySelector("#sell-quantity");

  if (quantityInput) {
    quantityInput.addEventListener("input", updateSalePreview);
  }

  const priceInput = document.querySelector("#sell-price");

  if (priceInput) {
    priceInput.addEventListener("input", updateSalePreview);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const assets = getSelectedSellAssets();
    const assetIds = assets.map((asset) => asset.id);

    const quantity = normalizeNumber(
      document.querySelector("#sell-quantity")?.value,
    );

    const sellPrice = normalizeNumber(
      document.querySelector("#sell-price")?.value,
    );

    const sellDate = document.querySelector("#sell-date")?.value;

    const asset = assets[0];

    if (!asset) {
      showNotice("Please select an asset.");

      return;
    }

    const available = assets.reduce((sum, item) => sum + getAvailableQuantity(item.id), 0);

    if (quantity <= 0) {
      showNotice("Enter a valid quantity.");

      return;
    }

    if (!["etf", "stock", "crypto_earn"].includes(asset.type) && !Number.isInteger(quantity)) {
      showNotice("Quantity must be a whole number.");

      return;
    }

    if (quantity > available) {
      showNotice(`Available quantity: ${formatQuantity(available)}`);

      return;
    }

    if (sellPrice < 0) {
      showNotice("Enter a valid sale price.");

      return;
    }

    if (!sellDate) {
      showNotice("Select sale date.");

      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');

    if (submitButton) {
      submitButton.disabled = true;

      submitButton.dataset.originalText = submitButton.textContent;

      submitButton.textContent = "Selling...";
    }

    try {
      await api.createSale(financialCommand(form, 'createSale', {
        assetId: asset.id,
        assetIds,

        quantity,

        sellPrice,

        sellDate,

        currency: asset.currency || "UAH",
      }).body);

      close();

      await loadData();

      showNotice("Sale successfully recorded.");
    } catch (error) {
      console.error("SALE ERROR:", window.FinoErrors.diagnostics(error));

      showNotice(error || "Failed to record sale.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;

        submitButton.textContent =
          submitButton.dataset.originalText || "Sell asset";
      }
    }
  });
}
Object.assign(window, { populateSellAssetSelect, getSelectedSellAssets, updateSalePreview, setupSellModal, openSellAssetModal });
})();
