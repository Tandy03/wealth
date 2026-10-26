// DOM-free application lifecycle; the browser wiring lives in composition.js.
export function createApplication({
  store, api, refreshData, render, initializeController,
  controllers, diagnostics, logger, showNotice, isNative,
}) {
  async function loadData() {
    const result = await refreshData();
    if (!result.applied) return result;
    render();
    return result;
  }
  async function init() {
    const setupErrors = [];
    for (const [name, setup] of controllers) {
      try { initializeController(setup); }
      catch (error) { setupErrors.push(error); logger.error(`${name} setup failed:`, diagnostics(error)); }
    }
    try {
      await loadData();
      if (setupErrors.length) throw new AggregateError(setupErrors, 'UI initialization failed.');
      const context = store.capture();
      void api.getData({ sync: true }).then(() => {
        if (store.isCurrent(context)) return loadData();
      }).catch(error => {
        if (store.isCurrent(context)) logger.warn('Background portfolio refresh failed:', diagnostics(error));
      });
    } catch (error) {
      logger.error('INITIALIZATION ERROR:', diagnostics(error));
      void showNotice(error?.requestId ? error : isNative()
        ? (error || 'Could not load your local portfolio. Reconnect Google Drive or restore a backup.')
        : 'Could not connect to the local API. Start the server with npm run dev.');
      throw error;
    }
  }
  return { loadData, init };
}
