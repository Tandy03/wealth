const { RemoteUnavailableError } = require('../../../frontend/js/errors');
function createRequestPolicy({ limit = 120, intervalMs = 60000, concurrency = 6, now = () => Date.now() } = {}) {
  const origins = new Map();
  function enter(url) {
    const origin = new URL(url).origin;
    let bucket = origins.get(origin);
    if (!bucket) { bucket = { started: now(), count: 0, active: 0 }; origins.set(origin, bucket); }
    else if (now() - bucket.started >= intervalMs) { bucket.started = now(); bucket.count = 0; }
    if (bucket.count >= limit || bucket.active >= concurrency) throw new RemoteUnavailableError({ code: 'PROVIDER_RATE_LIMITED', status: 429, message: 'External request limit reached. Retry later; local data is preserved.' });
    bucket.count++; bucket.active++;
    let released = false;
    return () => { if (!released) { bucket.active--; released = true; } };
  }
  return { enter };
}
const requestPolicy = createRequestPolicy();
module.exports = { createRequestPolicy, requestPolicy };
