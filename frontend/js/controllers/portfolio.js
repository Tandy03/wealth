// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createControllersPortfolio({
  api,
  document,
  loadData,
  openEditAssetModal,
  openHoldingSelectionModal,
  showConfirm,
  stateStore,
  ui,
}) {
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
    ui.asset.open(row.dataset.assetGroup.split(','), { from: 'portfolio' });
  }));
  tbody.querySelectorAll('[data-asset-group]').forEach(row => {
    row.tabIndex = 0; row.setAttribute('role', 'button');
    row.addEventListener('keydown', event => {
      if (event.target !== row || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); ui.asset.open(row.dataset.assetGroup.split(','), { from: 'portfolio' });
    });
  });
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
return { bindHoldingDetailActions, bindPortfolioActions };
}
