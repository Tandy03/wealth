// Bound both response headers and JSON consumption, including stalled providers.
async function requestJson(url, options = {}, { fetchImpl = (...args) => fetch(...args), timeoutMs = 10000, policy = require('./policy').requestPolicy } = {}) {
  const release = policy.enter(url);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error('External provider timed out.');
      error.code = 'EXTERNAL_API_TIMEOUT';
      error.status = 504;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (!response.ok) { const error = new Error(`External provider returned HTTP ${response.status}.`); error.status = 502; throw error; }
      const payload = await response.json();
      require('../../../shared/state-model').validateJson(payload);
      if (JSON.stringify(payload).length > 5 * 1024 * 1024) throw new Error('External provider response is too large.');
      return payload;
    })()]);
  } finally { clearTimeout(timer); release(); }
}
module.exports = { requestJson };
