(function () {
const state = stateStore.getState();
// Application wiring and centralized render triggers.
function renderApplication(snapshot = stateStore.getState()) {
  window.ui.dashboard.render(snapshot);
  window.ui.portfolio.render(snapshot);
  window.ui.calculators.rebalance(snapshot);
  window.ui.transactions.render(snapshot);
  window.ui.calendar.render(snapshot);
  window.ui.calculators.render(snapshot);
  window.ui.wallet.render(snapshot);
  populateSellAssetSelect();
}
function renderMarketViews(snapshot = stateStore.getState()) {
  window.ui.calculators.rebalance(snapshot);
  window.ui.dashboard.render(snapshot);
  window.ui.portfolio.render(snapshot);
  window.ui.transactions.render(snapshot);
  window.ui.calculators.render(snapshot);
  window.ui.wallet.render(snapshot);
}
let stopRenderSubscription = null;
const initializedUiControllers = new WeakSet();
function initializeUiController(setup) {
  if (initializedUiControllers.has(setup)) return;
  setup();
  initializedUiControllers.add(setup);
}
function setupRenderSubscriptions() {
  if (stopRenderSubscription) return;
  stopRenderSubscription = stateStore.subscribe(({ type, keys, state }) => {
    if (type === 'ui:changed' && keys.includes('marketRevision')) renderMarketViews(state);
  });
}
function setupPortfolioSort() {
  const select = document.querySelector("#portfolio-sort");

  if (!select) {
    return;
  }

  select.value = state.portfolioSort;

  select.addEventListener("change", () => {
    stateStore.setUI({ portfolioSort: select.value });
    renderPortfolio();
  });
}


function setupInzhurSync() {
  const button = document.querySelector("#sync-inzhur-btn");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    const defaultLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Syncing...";

    try {
      const result = await api.syncInzhurAssets();
      await loadData();

      const skipped = result.skipped?.length
        ? ` ${result.skipped.length} asset(s) were skipped — add an ISIN for OVDP or use a supported Inzhur fund type.`
        : "";
      const binanceSynced = result.binanceSynced?.length || 0;
      const binanceErrorHints = {
        BINANCE_NOT_CONFIGURED: "add BINANCE_API_KEY to the root .env file and restart the server",
        EQUITY_NOT_FOUND: "the Binance tokenized-equity symbol or underlying ticker was not found",
        QUOTE_NOT_AVAILABLE: "Binance did not return a current bid/ask quote",
        BINANCE_RATE_LIMITED: "Binance rate-limited the request; try again later",
        BINANCE_TIMEOUT: "the Binance request timed out; try again",
      };
      const binanceSkipped = result.binanceSkipped?.length
        ? ` Binance not updated: ${result.binanceSkipped.map((item) => {
          const holding = item.symbol || item.name || "holding";
          const reason = binanceErrorHints[item.error] || item.message || "Binance API request failed";
          return `${holding} — ${reason}`;
        }).join("; ")}.`
        : "";
      showNotice(`Synchronized ${result.synced.length} Inzhur asset(s) and ${binanceSynced} Binance holding(s).${skipped}${binanceSkipped}`);
    } catch (error) {
      console.error(error);
      showNotice(error.message || "Could not synchronize assets.");
    } finally {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  });
}


function setupNavigation() {
  const titleMap = {
    dashboard: "Dashboard",

    portfolio: "Portfolio",

    transactions: "Transactions",

    calendar: "Calendar",

    analytics: "Analytics",

    rebalance: "Rebalance",

    market: "Market",

    macroeconomics: "Macroeconomics",
  };

  document.querySelectorAll("#investments-app .nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section;

      document.querySelectorAll("#investments-app .nav-item").forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      document.querySelectorAll(".page-section").forEach((item) => {
        item.classList.toggle("active", item.id === `${section}-section`);
      });

      const pageTitle = document.querySelector("#page-title");

      if (pageTitle) {
        pageTitle.textContent = titleMap[section] || section;
      }

      if (section === "calendar") {
        renderCalendar();
      }

      if (section === "analytics") {
        renderProfitCalculator();
      }

      if (section === "rebalance") {
        renderRebalanceCalculator();
      }

      if (section === "market") {
        populateMarketSymbols();
        renderMarketChart();
      }

      if (section === "macroeconomics" && !stateStore.getState().macroLoaded) renderMacroeconomics();
    });
  });
}


function setupGlobalErrorHandling() {
  window.addEventListener("error", (event) => {
    console.error("JavaScript error:", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", event.reason);
  });
}


function disableNumberInputWheelChanges() {
  document.addEventListener("wheel", (event) => {
    const input = event.target.closest?.('input[type="number"]');
    if (input && document.activeElement === input) input.blur();
  }, { capture: true });
}


function applyResponsiveTableLabels() {
  document.querySelectorAll(".table-wrap table:not(.wallet-table), .table-wrapper table:not(.wallet-table)").forEach((table) => {
    table.classList.add("responsive-card-table");
    const headers = [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim());
    table.querySelectorAll("tbody tr, tfoot tr").forEach((row) => {
      let columnIndex = 0;
      [...row.children].forEach((cell) => {
        const colspan = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
        const label = headers[columnIndex] || "Actions";
        cell.dataset.label = label;
        cell.classList.toggle("empty-value", cell.textContent.trim() === "—");
        columnIndex += colspan;
      });
    });
  });
}


function setupResponsiveTables() {
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyResponsiveTableLabels();
    });
  };
  applyResponsiveTableLabels();
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
}
Object.assign(window, { renderApplication, renderMarketViews, initializeUiController, setupRenderSubscriptions, setupPortfolioSort, setupInzhurSync, setupNavigation, setupGlobalErrorHandling, disableNumberInputWheelChanges, applyResponsiveTableLabels, setupResponsiveTables });
})();
