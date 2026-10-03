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
      throw error;
    }
    return data;
  }
  function createService({ fetch: fetchRequest }) {
    return {
      async request(url, { method = 'GET', body, message = 'Request failed.' } = {}) {
        const options = { method };
        if (body !== undefined) { options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(body); }
        return readJson(await fetchRequest(url, options), message);
      },
    };
  }
  return { createService, readJson };
});
