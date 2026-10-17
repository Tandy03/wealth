(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoFetchers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  async function readJson(response, fallbackMessage) {
    const contentType = response.headers?.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('The backend is running an older version. Restart the server and try again.');
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || fallbackMessage);
      error.status = response.status;
      error.category = response.headers?.get('x-error-category') || null;
      error.requestId = response.headers?.get('x-request-id') || null;
      error.code = data.code || null;
      error.details = data.status || null;
      throw error;
    }
    const state = response.headers?.get('x-save-state');
    if (state && data && typeof data === 'object') Object.defineProperty(data, 'persistence', { value: {
      state, savedLocally: response.headers.get('x-saved-locally') === 'true', savedRemotely: response.headers.get('x-saved-remotely') === 'true',
      backupSaved: response.headers.get('x-backup-saved') === 'true' }, enumerable: false });
    return data;
  }
  function createService({ fetch: fetchRequest, recoverSession = false }) {
    let sessionRenewal = null;
    let sessionGeneration = 0;
    async function renewSession() {
      if (!sessionRenewal) sessionRenewal = (async () => {
        const response = await fetchRequest('/api/session', {
          method: 'POST', headers: { 'X-Fino-Session': 'renew' }, credentials: 'same-origin', cache: 'no-store',
        });
        if (!response.ok) await readJson(response, 'Could not renew the local browser session. Refresh the page and try again.');
        sessionGeneration++;
      })().finally(() => { sessionRenewal = null; });
      return sessionRenewal;
    }
    return {
      async request(url, { method = 'GET', body, message = 'Request failed.', keepalive = false } = {}) {
        const options = { method };
        if (body !== undefined) { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(body); }
        // Three bytes per UTF-16 code unit is a conservative UTF-8 bound.
        if (keepalive && options.body && options.body.length * 3 < 60000) options.keepalive = true;
        const generation = sessionGeneration;
        try { return await readJson(await fetchRequest(url, options), message); }
        catch (error) {
          const enabled = typeof recoverSession === 'function' ? recoverSession() : recoverSession;
          if (!enabled || !/^\/api\//.test(url) || error.status !== 403 || error.code !== 'BROWSER_SESSION_REQUIRED') throw error;
          if (generation === sessionGeneration) await renewSession();
          // The session guard rejects before any financial handler. Retry that rejected request once only.
          return readJson(await fetchRequest(url, options), message);
        }
      },
    };
  }
  return { createService, readJson };
});
