const { fetchWithTimeout } = require('../../../frontend/js/request');
const { requestPolicy } = require('./policy');
async function providerFetch(url, options = {}, { timeoutMs = 10000, fetchImpl, policy = requestPolicy } = {}) {
  const release = policy.enter(url);
  try {
    const response = await fetchWithTimeout(url, options, { timeoutMs, ...(fetchImpl ? { fetchImpl } : {}) });
    // Include body reading in the request slot; the deadline wrapper bounds all body methods.
    const reads = ['json', 'text', 'arrayBuffer', 'blob'];
    let timer = setTimeout(release, timeoutMs + 1000); timer.unref?.();
    return new Proxy(response, { get(target, key) {
      if (reads.includes(key) && typeof target[key] === 'function') return async () => {
        try {
          const value = await target[key]();
          if (key === 'json') require('../../../frontend/js/state-model').validateJson(value);
          if (key === 'text' && value.length > 5 * 1024 * 1024) throw new Error('External response is too large.');
          if (key === 'arrayBuffer' && value.byteLength > 10 * 1024 * 1024) throw new Error('External response is too large.');
          return value;
        } finally { clearTimeout(timer); release(); }
      };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } catch (error) { release(); throw error; }
}
module.exports = { providerFetch };
