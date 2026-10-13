(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoRequest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const buckets = new Map();
  function enter(url) {
    // Node providers use their own shared policy. This gate protects native direct requests.
    if (typeof module === 'object' && module.exports) return () => {};
    const origin = new URL(url, root.location?.href || 'https://localhost').origin;
    let bucket = buckets.get(origin);
    if (!bucket) { bucket = { start: Date.now(), count: 0, active: 0 }; buckets.set(origin, bucket); }
    else if (Date.now() - bucket.start >= 60000) { bucket.start = Date.now(); bucket.count = 0; }
    if (bucket.count >= 120 || bucket.active >= 6) {
      const error = new Error('External request limit reached. Retry later.'); error.code = 'PROVIDER_RATE_LIMITED'; error.status = 429; throw error;
    }
    bucket.count++; bucket.active++;
    let released = false; return () => { if (!released) { bucket.active--; released = true; } };
  }
  async function deadline(operation, controller, timeoutMs) {
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error('External provider timed out.');
          error.code = 'EXTERNAL_API_TIMEOUT';
          error.status = 504;
          reject(error);
        }, timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function fetchWithTimeout(url, options = {}, { fetchImpl = (...args) => root.fetch(...args), timeoutMs = 10000 } = {}) {
    const controller = new AbortController();
    const release = enter(url);
    let response;
    try { response = await deadline(() => fetchImpl(url, { ...options, signal: controller.signal }), controller, timeoutMs); }
    catch (error) { release(); throw error; }
    let bodyTimer = setTimeout(release, timeoutMs); bodyTimer.unref?.();
    return new Proxy(response, {
      get(target, key) {
        if (['json', 'text', 'arrayBuffer', 'blob'].includes(key) && typeof target[key] === 'function') return async () => {
          try {
            const result = await deadline(() => target[key](), controller, timeoutMs);
            if (key === 'json') root.FinoStateModel?.validateJson(result);
            if (key === 'text' && result.length > 5 * 1024 * 1024) throw new Error('External response is too large.');
            return result;
          } finally { clearTimeout(bodyTimer); release(); }
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  return { fetchWithTimeout };
});
