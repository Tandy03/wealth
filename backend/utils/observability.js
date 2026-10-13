const { randomUUID } = require('node:crypto');
const sensitive = /token|secret|password|authorization|cookie|credential|email|name|balance|amount|price|quantity|assets|transactions|payments|wallet|body|snapshot|data|payload|cause|message|stack|url/i;
function redact(value, key = '', depth = 0) {
  if (sensitive.test(key)) return '[redacted]';
  if (depth > 5) return '[redacted]';
  if (Array.isArray(value)) return '[redacted]';
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, redact(item, field, depth + 1)]));
  if (typeof value === 'string') return value.replace(/Bearer\s+\S+|https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gi, '[redacted]').slice(0, 150);
  return value;
}
const safeFields = new Set(['requestId', 'method', 'route', 'status', 'category', 'durationMs', 'code', 'revision', 'provider', 'attempt', 'action', 'count']);
function logEvent(event, fields = {}) {
  // Never include bodies, balances, tokens, remote payloads or user-provided error messages.
  const allowed = Object.fromEntries(Object.entries(fields).filter(([key]) => safeFields.has(key)));
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event: /^[a-z][a-z0-9_.-]{0,80}$/.test(event) ? event : 'application.event', ...redact(allowed) }));
}
function classifyError(status) {
    return ({ 400: 'validation', 401: 'auth_required', 403: 'access_denied', 404: 'not_found', 409: 'conflict', 413: 'validation', 415: 'validation', 422: 'validation', 429: 'remote_unavailable', 502: 'remote_unavailable', 503: 'storage_failure', 504: 'remote_unavailable' })[status] || 'internal_error';
}
function observeApi(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader('X-Request-Id', requestId);
  const json = res.json;
  res.json = function (body) {
    if (res.statusCode >= 400) res.setHeader('X-Error-Category', ['validation', 'auth_required', 'storage_failure', 'remote_unavailable', 'conflict', 'access_denied', 'not_found', 'internal_error'].includes(body?.category) ? body.category : classifyError(res.statusCode));
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
module.exports = { logEvent, redact, classifyError, observeApi };
