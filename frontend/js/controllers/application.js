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
  window.ui.asset.render(snapshot);
}
function renderMarketViews(snapshot = stateStore.getState()) {
  window.ui.asset.render(snapshot);
  window.ui.calculators.rebalance(snapshot);
  window.ui.dashboard.render(snapshot);
  window.ui.portfolio.render(snapshot);
  window.ui.transactions.render(snapshot);
  window.ui.calculators.render(snapshot);
  window.ui.wallet.render(snapshot);
}
let stopRenderSubscription = null;
function setupCommandRecovery() {
  const panel = document.querySelector('#command-recovery');
  if (!panel || !api.outbox) return;
  let sequence = 0;
  const labels = { createAsset: 'Create asset', buyMoreAsset: 'Buy asset', createSale: 'Sell asset', createTransaction: 'Transaction',
    createPayment: 'Payment', markPaymentReceived: 'Receive payment', createCalendarNote: 'Calendar note', mergeAssets: 'Merge assets' };
  const states = { queued: 'Saved locally; not sent', 'in-flight': 'Waiting for confirmation',
    'outcome-unknown': 'Result unknown; recover the original request', confirmed: 'Confirmed; saved response retained locally',
    rejected: 'Rejected; review the request', conflict: 'Conflict; review before continuing' };
  async function refresh() {
    const current = ++sequence;
    try {
      const result = await api.outbox.list();
      if (current !== sequence) return;
      if (!result.corrupt && !result.entries.length && panel.hidden) return;
      panel.replaceChildren(); panel.hidden = !result.corrupt && !result.entries.length;
      if (panel.hidden) return;
      const title = document.createElement('strong'); title.textContent = 'Command recovery'; panel.append(title);
      if (result.corrupt) {
        const notice = document.createElement('p');
        notice.textContent = 'Local recovery data is damaged and has been preserved. No commands will be sent. Code: ' + result.code;
        panel.append(notice); return;
      }
      for (const entry of result.entries) {
        const row = document.createElement('div'); row.className = 'command-recovery-row';
        const message = document.createElement('span');
        const expired = entry.lastErrorCode === 'OPERATION_RESULT_EXPIRED';
        message.textContent = `${labels[entry.method]} — ${expired ? 'Already recorded; replay result expired. Reload the portfolio to review it.' : states[entry.state]}${entry.lastErrorCode ? ' (' + entry.lastErrorCode + ')' : ''}`;
        row.append(message);
        const retryable = ['queued', 'outcome-unknown'].includes(entry.state);
        if (entry.state !== 'in-flight') {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn';
          button.textContent = retryable ? 'Retry original command' : expired ? 'Reload portfolio' : 'Dismiss';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              if (retryable) { await api.outbox.retry(entry.operationId, result.scope); await loadData(); }
              else { if (entry.lastErrorCode === 'OPERATION_RESULT_EXPIRED') await loadData(); await api.outbox.dismiss(entry.operationId, result.scope); }
            } catch (error) { void showNotice(error); }
            finally { await refresh(); }
          });
          row.append(button);
        }
        panel.append(row);
      }
    } catch (error) {
      if (current !== sequence) return;
      panel.hidden = false; panel.textContent = window.FinoErrors.displayMessage(error);
    }
  }
  document.addEventListener('fino:outbox-changed', () => { void refresh(); });
  stateStore.subscribe(({ type }) => { if (type === 'data:changed') void refresh(); });
  void refresh();
}
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
    if (type === 'ui:changed' && keys.includes('sp500BenchmarkStatus')) setReturnBenchmarkHover(document.querySelector('#stat-roi'), undefined, state);
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
      console.error(window.FinoErrors.diagnostics(error));
      showNotice(error || "Could not synchronize assets.");
    } finally {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  });
}


function setupNavigation() {
  const compact = window.matchMedia('(max-width: 700px)');
  const arrangeMetrics = () => document.querySelectorAll('#dashboard-section .dashboard-more-metrics, #dashboard-section .stat-explanation').forEach(details => { details.open = !compact.matches; });
  arrangeMetrics();
  compact.addEventListener?.('change', arrangeMetrics);
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
    console.error("JavaScript error:", window.FinoErrors.diagnostics(event.error));
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", window.FinoErrors.diagnostics(event.reason));
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
Object.assign(window, { renderApplication, renderMarketViews, initializeUiController, setupRenderSubscriptions, setupPortfolioSort, setupInzhurSync, setupNavigation, setupGlobalErrorHandling, disableNumberInputWheelChanges, applyResponsiveTableLabels, setupResponsiveTables, setupCommandRecovery });
})();
