// app.js
function setupPortfolioSort() {
  const select = document.querySelector("#portfolio-sort");

  if (!select) {
    return;
  }

  select.value = state.portfolioSort;

  select.addEventListener("change", () => {
    state.portfolioSort = select.value;
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

      if (section === "macroeconomics" && !macroLoaded) renderMacroeconomics();
    });
  });
}

async function loadData() {
  await refreshApplicationData();

  console.log("Investment Tracker data loaded:", state.data);

  /*
   * Render everything.
   */

  renderDashboard();
  updateSp500Benchmark();

  renderPortfolio();

  renderRebalanceCalculator();

  renderTransactions();

  renderCalendar();

  renderProfitCalculator();

  renderWallet();

  populateSellAssetSelect();
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

async function init() {
  console.log("Investment Tracker initializing...");
  setupNoticeModal();
  setupModalBackdropClosing();

  /*
   * Important:
   *
   * Each setup function is isolated.
   * One broken/missing module cannot
   * stop Add Asset from working.
   */

  try {
    setupGlobalErrorHandling();
    disableNumberInputWheelChanges();
    setupGoogleDriveSync();
    setupSettingsModal();
    setupResponsiveTables();
  } catch (error) {
    console.error("Global error setup failed:", error);
  }

  try {
    setupNavigation();
  } catch (error) {
    console.error("Navigation setup failed:", error);
  }

  try {
    setupModal();
  } catch (error) {
    console.error("Asset modal setup failed:", error);
  }

  try {
    setupBuyMoreModal();
  } catch (error) {
    console.error("Buy more modal setup failed:", error);
  }

  try {
    setupCalendarNavigation();
  } catch (error) {
    console.error("Calendar navigation setup failed:", error);
  }

  try {
    setupEventModal();
  } catch (error) {
    console.error("Event modal setup failed:", error);
  }

  try {
    setupNoteModal();
  } catch (error) {
    console.error("Note modal setup failed:", error);
  }

  try {
    setupSellModal();
  } catch (error) {
    console.error("Sell modal setup failed:", error);
  }

  try {
    setupProfitCalculator();
  } catch (error) {
    console.error("Profit calculator setup failed:", error);
  }

  try {
    setupPortfolioSort();
    setupRebalanceCalculator();
    setupMarket();
    setupInzhurSync();
    setupThemeToggle();
    setupAssetTransactionsModal();
    setupDeleteHoldingModal();
  } catch (error) {
    console.error("Portfolio controls setup failed:", error);
  }

  try {
    setupWallet();
    setupLoans();
  } catch (error) {
    console.error("Wallet setup failed:", error);
  }

  /*
   * Load data AFTER all event listeners
   * have been initialized.
   */

  try {
    await loadData();

    console.log("Investment Tracker initialized successfully.");
    if (window.mobileApi) {
      // Render the account's local snapshot first, then refresh from Drive.
      void api.getData().then(() => loadData()).catch(error => {
        console.warn('Background portfolio refresh failed:', error.message);
      });
    }
  } catch (error) {
    console.error("INITIALIZATION ERROR:", error);

    showNotice(
      window.mobileApi ? (error.message || "Could not load your local portfolio. Reconnect Google Drive or restore a backup.") : "Could not connect to the local API. Start the server with npm run dev.",
    );
  }
}

document.addEventListener("DOMContentLoaded", init);
