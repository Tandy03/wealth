// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createControllersApplication({
  FinoErrors,
  FinoI18n,
  MutationObserver,
  api,
  console,
  document,
  loadData,
  populateMarketSymbols,
  populateSellAssetSelect,
  renderCalendar,
  renderMacroeconomics,
  renderMarketChart,
  renderPortfolio,
  renderProfitCalculator,
  renderRebalanceCalculator,
  requestAnimationFrame,
  showNotice,
  stateStore,
  ui,
  window,
}) {
// Application wiring and centralized render triggers.
function renderApplication(snapshot = stateStore.getState()) {
  ui.dashboard.render(snapshot);
  ui.portfolio.render(snapshot);
  ui.calculators.rebalance(snapshot);
  ui.transactions.render(snapshot);
  ui.calendar.render(snapshot);
  ui.calculators.render(snapshot);
  ui.wallet.render(snapshot);
  populateSellAssetSelect();
  ui.asset.render(snapshot);
}
function renderMarketViews(snapshot = stateStore.getState()) {
  // FX updates invalidate derived views, not the financial document. Hidden
  // views use the latest snapshot when opened, without rebuilding their DOM now.
  const wallet = document.querySelector('#wallet-app');
  if (wallet && !wallet.hidden) {
    ui.wallet.render(snapshot);
    return;
  }
  const renderers = {
    'asset-detail-section': ui.asset.render,
    'dashboard-section': ui.dashboard.render,
    'portfolio-section': ui.portfolio.render,
    'transactions-section': ui.transactions.render,
    'analytics-section': ui.calculators.render,
    'rebalance-section': ui.calculators.rebalance,
  };
  const active = document.querySelector('#investments-app .page-section.active');
  renderers[active?.id]?.(snapshot);
}
let stopRenderSubscription = null;
function setupCommandRecovery() {
  const panel = document.querySelector('#command-recovery');
  if (!panel || !api.outbox) return;
  const t = key => FinoI18n.t(key);
  let sequence = 0;
  const labels = { createAsset: 'Create asset', buyMoreAsset: 'Buy asset', createSale: 'Sell asset', createTransaction: 'Create transaction',
    createPayment: 'Create payment', markPaymentReceived: 'Receive payment', createCalendarNote: 'Create calendar note', mergeAssets: 'Merge assets' };
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
      const title = document.createElement('strong'); title.textContent = t('Command recovery'); panel.append(title);
      if (result.corrupt) {
        const notice = document.createElement('p');
        notice.textContent = FinoI18n.format('Local recovery data is damaged and has been preserved. No commands will be sent. Code: {code}', { code: result.code });
        panel.append(notice); return;
      }
      for (const entry of result.entries) {
        const row = document.createElement('div'); row.className = 'command-recovery-row';
        const message = document.createElement('span');
        const expired = entry.lastErrorCode === 'OPERATION_RESULT_EXPIRED';
        message.textContent = `${t(labels[entry.method] || 'Financial command')} — ${t(expired ? 'Already recorded; replay result expired. Reload the portfolio to review it.' : states[entry.state] || 'Unknown status')}${entry.lastErrorCode ? ' (' + entry.lastErrorCode + ')' : ''}`;
        row.append(message);
        const retryable = ['queued', 'outcome-unknown'].includes(entry.state);
        if (entry.state !== 'in-flight') {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn';
          button.textContent = t(retryable ? 'Retry original command' : expired ? 'Reload portfolio' : 'Dismiss');
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
      panel.hidden = false; panel.textContent = FinoErrors.displayMessage(error);
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
  });
}
function setupPortfolioSort() {
  const select = document.querySelector("#portfolio-sort");

  if (!select) {
    return;
  }

  select.value = stateStore.getState().portfolioSort;

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
      console.error(FinoErrors.diagnostics(error));
      showNotice(error || "Could not synchronize assets.");
    } finally {
      button.disabled = false;
      button.textContent = defaultLabel;
    }
  });
}


// Native page gestures reuse navigation clicks; they never modify portfolio data.
function setupNativeSectionSwipes() {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  let gesture = null;
  const blocked = 'input, textarea, select, button, a, label, summary, canvas, video, audio, [role="slider"], [role="button"], [contenteditable]:not([contenteditable="false"]), [data-no-swipe]';
  const reset = () => { gesture = null; };
  const obstructed = () => Boolean(document.querySelector('.modal-backdrop.open, #mobile-more-backdrop:not([hidden])') || window.getSelection()?.toString());
  document.querySelectorAll('.app-shell > .main').forEach(main => {
    const shell = main.closest('.app-shell');
    const wallet = shell.id === 'wallet-app';
    const buttons = [...shell.querySelectorAll(wallet ? '.wallet-tab' : '.nav-item[data-section]')];
    const activePage = () => main.querySelector(wallet ? '.wallet-page.active' : '.page-section.active');
    const matchesPage = (button, page) => page?.id === (wallet ? `wallet-${button.dataset.walletTab}` : `${button.dataset.section}-section`);
    main.addEventListener('touchstart', event => {
      reset();
      if (event.touches.length !== 1 || shell.hidden || obstructed() || event.target.closest?.(blocked)) return;
      const page = activePage(), touch = event.touches[0];
      const index = buttons.findIndex(button => button.classList.contains('active') && matchesPage(button, page));
      // Leave screen edges to Android's back gesture, and scrolling regions to their contents.
      if (index < 0 || !page.contains(event.target) || touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return;
      for (let node = event.target; node && node !== main; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1 && /^(auto|scroll|overlay)$/.test(window.getComputedStyle(node).overflowX)) return;
      }
      gesture = { main, page, index, id: touch.identifier, x: touch.clientX, y: touch.clientY, started: event.timeStamp };
    }, { passive: true });
    main.addEventListener('touchmove', event => {
      if (!gesture || gesture.main !== main) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || touch.identifier !== gesture.id) return reset();
      const dx = Math.abs(touch.clientX - gesture.x), dy = Math.abs(touch.clientY - gesture.y);
      // Once a gesture becomes a vertical scroll, it cannot later turn into navigation.
      if (dy > 12 && dy >= dx) reset();
    }, { passive: true });
    main.addEventListener('touchend', event => {
      const start = gesture;
      reset();
      if (!start || start.main !== main || event.touches.length || shell.hidden || obstructed()) return;
      const touch = [...event.changedTouches].find(item => item.identifier === start.id);
      if (!touch || activePage() !== start.page || !buttons[start.index].classList.contains('active')) return;
      const dx = touch.clientX - start.x, dy = Math.abs(touch.clientY - start.y);
      const next = buttons[start.index + (dx < 0 ? 1 : -1)];
      if (!next || next.disabled || Math.abs(dx) < 72 || Math.abs(dx) < dy * 1.8 || dy > 48 || event.timeStamp - start.started > 750) return;
      // Suppress the compatibility click only for an accepted navigation swipe.
      if (event.cancelable) event.preventDefault();
      next.click();
      const nav = next.closest('.nav');
      if (nav && nav.scrollWidth > nav.clientWidth) {
        nav.scrollLeft += next.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - next.offsetWidth) / 2;
      }
    }, { passive: false });
    main.addEventListener('touchcancel', reset, { passive: true });
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

      // These views may have been hidden when market/FX metadata changed.
      const latest = stateStore.getState();
      if (section === 'dashboard') ui.dashboard.render(latest);
      if (section === 'portfolio') ui.portfolio.render(latest);
      if (section === 'transactions') ui.transactions.render(latest);

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
  setupNativeSectionSwipes();
}


function setupGlobalErrorHandling() {
  window.addEventListener("error", (event) => {
    console.error("JavaScript error:", FinoErrors.diagnostics(event.error));
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unhandled promise rejection:", FinoErrors.diagnostics(event.reason));
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
return { applyResponsiveTableLabels, disableNumberInputWheelChanges, initializeUiController, renderApplication, renderMarketViews, setupGlobalErrorHandling, setupInzhurSync, setupNavigation, setupPortfolioSort, setupRenderSubscriptions, setupResponsiveTables, setupCommandRecovery };
}
