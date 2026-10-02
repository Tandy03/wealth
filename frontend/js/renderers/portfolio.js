// renderers/portfolio.js
function setupPortfolioCurrencyHover(container) {
  container.querySelectorAll(".portfolio-currency-hover").forEach((element) => {
    const showUah = () => { element.textContent = element.dataset.uah; };
    const showOriginal = () => { element.textContent = element.dataset.original; };
    element.addEventListener("mouseenter", showUah);
    element.addEventListener("mouseleave", showOriginal);
    element.addEventListener("focus", showUah);
    element.addEventListener("blur", showOriginal);
  });
}

function renderPortfolio() {
  const tbody = document.querySelector("#portfolio-table");

  if (!tbody) {
    return;
  }

  if (!state.data.assets.length) {
    tbody.innerHTML = `
            <tr>
                <td
                    colspan="9"
                    class="empty-state"
                >
                    No assets yet.
                </td>
            </tr>
        `;

    return;
  }

  const today = getDateString(new Date());

  const getNextPaymentDate = (assetId) =>
    (state.data.payments || [])
      .filter(
        (payment) =>
          payment.assetId === assetId &&
          payment.date >= today &&
          payment.status !== "received" &&
          payment.status !== "paid",
      )
      .map((payment) => payment.date)
      .sort()[0] || "9999-12-31";

  const rawAssets = state.data.assets
    .filter((asset) => getAvailableQuantity(asset.id) > 0)
    .sort((a, b) => {
      if (state.portfolioSort === "next-payment") {
        return getNextPaymentDate(a.id).localeCompare(getNextPaymentDate(b.id));
      }

      if (state.portfolioSort === "invested") {
        const aInvested = getAssetInvestedUah(a);
        const bInvested = getAssetInvestedUah(b);

        return bInvested - aInvested;
      }

      return String(a.purchaseDate || "").localeCompare(String(b.purchaseDate || ""));
    });

  const assets = Object.values(rawAssets.reduce((groups, asset) => {
    const key = `${asset.type}::${String(asset.name).trim().toLowerCase()}`;
    groups[key] ||= { ...asset, _assets: [] };
    groups[key]._assets.push(asset);
    return groups;
  }, {}));

  if (!assets.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">No active assets.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = assets
    .map((asset) => {
      const available = asset._assets.reduce((sum, item) => sum + getAvailableQuantity(item.id), 0);
      const currencies = [...new Set(asset._assets.map((item) => item.currency || "UAH"))];
      const displayCurrency = currencies.length === 1 ? currencies[0] : "USD";
      const invested = asset._assets.reduce((sum, item) => sum + (item.type === "crypto_earn"
        ? convertCurrency(getAssetInvestedUah(item), "UAH", displayCurrency)
        : convertCurrency(getAvailableQuantity(item.id) * normalizeNumber(item.purchasePrice), item.currency, displayCurrency)), 0);
      const investedUah = asset._assets.reduce(
        (sum, item) => sum + getAssetInvestedUah(item),
        0,
      );
      const currentValue = asset._assets.reduce((sum, item) => sum + convertCurrency(getAvailableQuantity(item.id) * getCurrentPrice(item), item.currency, displayCurrency), 0);
      const averagePrice = available > 0 ? invested / available : 0;
      const averageCurrentPrice = available > 0 ? currentValue / available : averagePrice;
      const instruments = [...new Set(asset._assets.map((item) => item.instrumentName || "—"))];
      const assetIds = asset._assets.map((item) => item.id);

      return `
                    <tr class="clickable-asset-row" data-asset-group="${escapeHtml(assetIds.join(","))}">

                        <td>
                            <strong>
                                ${escapeHtml(asset.name)}
                            </strong>
                        </td>

                        <td>
                            ${typeLabels[asset.type] || escapeHtml(asset.type)}
                        </td>

                        <td>${escapeHtml(instruments.length === 1 ? instruments[0] : `${instruments.length} instruments`)}</td>

                        <td>
                            ${formatQuantity(available)}
                        </td>

                        <td>
                            ${portfolioMoneyWithUahHover(averagePrice, displayCurrency)}
                        </td>

                        <td>
                            ${asset.type === "savings" ? "—" : portfolioMoneyWithUahHover(averageCurrentPrice, displayCurrency)}
                        </td>

                        <td>
                            ${portfolioMoneyWithUahHover(invested, displayCurrency, investedUah)}
                        </td>

                        <td>
                            ${formatDate(asset.purchaseDate)}
                        </td>

                        <td>
    <div class="asset-actions">
    
        <button
    type="button"
    class="secondary-btn"
    data-buy-assets="${escapeHtml(assetIds.join(","))}"
>
    Buy
</button>

        <button
            type="button"
            class="secondary-btn"
            data-edit-assets="${escapeHtml(assetIds.join(","))}"
        >
            Edit
        </button>

        <button
            type="button"
            class="danger-btn"
            data-delete-assets="${escapeHtml(assetIds.join(","))}"
        >
            Delete
        </button>

    </div>
</td>

                    </tr>
                `;
    })
    .join("");

  setupPortfolioCurrencyHover(tbody);

  tbody.querySelectorAll("[data-buy-assets]").forEach((button) => {
    button.addEventListener("click", () => {
      openHoldingSelectionModal(button.dataset.buyAssets.split(","), "buy");
    });
  });

  tbody.querySelectorAll("[data-edit-assets]").forEach((button) => {
    button.addEventListener("click", () => {
      openHoldingSelectionModal(button.dataset.editAssets.split(","), "edit");
    });
  });

  tbody.querySelectorAll("[data-delete-assets]").forEach((button) => {
    button.addEventListener("click", () => {
      openHoldingSelectionModal(button.dataset.deleteAssets.split(","), "delete");
    });
  });

  tbody.querySelectorAll("[data-asset-group]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openAssetTransactions(row.dataset.assetGroup.split(","));
  }));
}

function renderAssetTransactionsModal() {
  const body = document.querySelector("#asset-transactions-body");
  const ids = state.assetDetailIds || [];
  if (!body) return;
  const hideSales = document.querySelector("#asset-hide-sales")?.checked;
  const onlyCurrent = document.querySelector("#asset-only-current")?.checked;
  if (onlyCurrent) {
    const holdings = state.data.assets.filter((asset) => ids.includes(asset.id) && getAvailableQuantity(asset.id) > 0);
    body.innerHTML = holdings.length ? holdings.map((asset) => `<tr><td>${formatDate(asset.purchaseDate)}</td><td>${escapeHtml(asset.instrumentName || "—")} — ${escapeHtml(asset.instrumentType || "")}</td><td>AVAILABLE</td><td>${getAvailableQuantity(asset.id)}</td><td>${money(getAvailableQuantity(asset.id) * asset.purchasePrice, asset.currency)}</td><td><button class="secondary-btn" data-detail-edit="${escapeHtml(asset.id)}">Edit</button> <button class="danger-btn" data-detail-delete="${escapeHtml(asset.id)}">Delete</button></td></tr>`).join("") : '<tr><td colspan="6" class="empty-state">No current holdings.</td></tr>';
    body.querySelectorAll("[data-detail-edit]").forEach((button) => button.addEventListener("click", () => openEditAssetModal(button.dataset.detailEdit)));
    body.querySelectorAll("[data-detail-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!(await showConfirm("Delete this holding and all related records?"))) return;
      await api.deleteAsset(button.dataset.detailDelete);
      document.querySelector("#asset-transactions-modal")?.classList.remove("open");
      await loadData();
    }));
    return;
  }
  let transactions = (state.data.transactions || []).filter((transaction) => ids.includes(transaction.assetId));
  if (hideSales) transactions = transactions.filter((transaction) => transaction.type === "BUY");
  transactions.sort((a, b) => String(getTransactionEffectiveDate(b) || "").localeCompare(String(getTransactionEffectiveDate(a) || "")));
  body.innerHTML = transactions.length ? transactions.map((transaction) => {
    const asset = state.data.assets.find((item) => item.id === transaction.assetId);
    return `<tr><td>${formatDate(getTransactionEffectiveDate(transaction))}</td><td>${escapeHtml(asset?.instrumentName || "—")}</td><td>${escapeHtml(transaction.type)}</td><td>${transaction.quantity ?? "—"}</td><td>${money(transaction.amount, transaction.currency || asset?.currency)}</td><td></td></tr>`;
  }).join("") : '<tr><td colspan="6" class="empty-state">No matching transactions.</td></tr>';
}
