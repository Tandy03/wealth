const { randomUUID } = require('node:crypto');
function logEvent(event, fields = {}) {
  // Never include bodies, balances, tokens, remote payloads or user-provided error messages.
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}
function classifyError(status) {
  return ({ 400: 'validation', 404: 'not_found', 409: 'conflict', 413: 'validation', 422: 'validation', 429: 'external_api_failure', 502: 'external_api_failure', 503: 'storage_failure' })[status] || 'internal_error';
}
function observeApi(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader('X-Request-Id', requestId);
  const json = res.json;
  res.json = function (body) {
    if (res.statusCode >= 400) res.setHeader('X-Error-Category', classifyError(res.statusCode));
    return json.call(this, body);
  };
  res.on('finish', () => {
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutation || res.statusCode >= 400) {
      const route = req.route?.path || '/api';
      const event = res.statusCode >= 400 ? (mutation ? 'mutation.rejected' : 'request.failed') : /sync|google-drive/.test(route) ? 'sync.completed' : 'mutation.committed';
      logEvent(event, { requestId, method: req.method, route, status: res.statusCode, category: res.statusCode >= 400 ? classifyError(res.statusCode) : undefined, durationMs: Date.now() - startedAt });
    }
  });
  next();
}
module.exports = { logEvent, classifyError, observeApi };
