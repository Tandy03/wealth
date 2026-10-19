(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('../../../shared/errors') : root.FinoErrors);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoFetchers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (errors) {
  function responseFailure(response, message) {
    const failure = new errors.RemoteUnavailableError({ message, status: response.ok === false ? response.status : 502 });
    failure.requestId = response.headers?.get('x-request-id');
    return errors.clientError(failure);
  }
  async function readJson(response, fallbackMessage, { external = false } = {}) {
    const contentType = response.headers?.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw responseFailure(response, external ? fallbackMessage : 'The backend is running an older version. Restart the server and try again.');
    }
    let data;
    try { data = await response.json(); }
    catch (_) {
      throw responseFailure(response, fallbackMessage);
    }
    if (!response.ok) {
      throw errors.clientError({ message: external ? fallbackMessage : data?.error || fallbackMessage,
        status: response.status, category: external ? 'remote_unavailable' : data?.category || response.headers?.get('x-error-category'),
        code: data?.code,
        payload: !external && data?.status ? { status: data.status } : undefined,
        requestId: response.headers?.get('x-request-id') }, { trusted: true });
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
        const external = !/^\/api\//.test(url);
        try { return await readJson(await fetchRequest(url, options), message, { external }); }
        catch (error) {
          const enabled = typeof recoverSession === 'function' ? recoverSession() : recoverSession;
          if (!enabled || external || error.status !== 403 || error.code !== 'BROWSER_SESSION_REQUIRED') throw errors.clientError(error, { fallbackCategory: 'remote_unavailable' });
          try {
            if (generation === sessionGeneration) await renewSession();
            // The session guard rejects before any financial handler. Retry that rejected request once only.
            return await readJson(await fetchRequest(url, options), message, { external });
          } catch (failure) { throw errors.clientError(failure, { fallbackCategory: 'remote_unavailable' }); }
        }
      },
    };
  }
  return { createService, readJson };
});
