(function () {
const state = stateStore.getState();
// Page event controllers; renderers never call transport directly.

function bindPortfolioActions(tbody) {
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

function bindHoldingDetailActions(body) {
    body.querySelectorAll("[data-detail-edit]").forEach((button) => button.addEventListener("click", () => openEditAssetModal(button.dataset.detailEdit)));
    body.querySelectorAll("[data-detail-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!(await showConfirm("Delete this holding and all related records?"))) return;
      await api.deleteAsset(button.dataset.detailDelete);
      document.querySelector("#asset-transactions-modal")?.classList.remove("open");
      await loadData();
    }));

}
Object.assign(window, { bindPortfolioActions, bindHoldingDetailActions });
})();
