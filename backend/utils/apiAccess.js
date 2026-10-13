const { DomainError } = require('./domainError');
const { randomBytes, timingSafeEqual } = require('node:crypto');
function createBrowserSession() {
  const session = randomBytes(32).toString('hex');
  const sameSession = value => typeof value === 'string' && value.length === session.length && timingSafeEqual(Buffer.from(value), Buffer.from(session));
  return {
    issue(req, res, next) {
      if (req.method === 'GET' && ['/', '/index.html'].includes(req.path)) res.cookie('fino_session', session, { httpOnly: true, sameSite: 'strict', path: '/' });
      next();
    },
    protect(req, res, next) {
      if (req.get('Origin') || req.get('Sec-Fetch-Site')) {
        const cookie = String(req.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('fino_session='))?.slice('fino_session='.length);
        if (!sameSession(cookie)) return next(new DomainError({ error: 'Open the application to establish a local browser session.' }, 403));
      }
      next();
    },
  };
}
function protectApi(req, res, next) {
  const deny = message => next(new DomainError({ error: message }, 403));
  const rawHost = req.get('Host') || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(rawHost)) return deny('The API is available only through localhost.');
  const peer = req.socket?.remoteAddress;
  if (peer && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return deny('Remote API connections are not allowed.');
  if (['Forwarded', 'X-Forwarded-Host', 'X-Forwarded-For', 'X-Forwarded-Proto', 'X-Original-URL', 'X-Rewrite-URL'].some(header => req.get(header))) return deny('Proxy forwarding to this local API is not allowed.');
  const origin = req.get('Origin');
  if (req.get('Sec-Fetch-Site') === 'cross-site') return deny('Cross-site API requests are not allowed.');
  const protocol = req.socket?.encrypted ? 'https' : 'http';
  if (origin && origin !== `${protocol}://${rawHost}`) return deny('API requests must come from the same origin.');
  if (req.get('Sec-Fetch-Site') === 'same-site') return deny('Use the application origin to access the API.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (Number(req.get('Content-Length')) > 0 || req.get('Transfer-Encoding')) && !req.is('application/json')) return next(new DomainError({ error: 'Request body must use application/json.' }, 415));
  res.set('Cache-Control', 'no-store');
  next();
}
module.exports = { protectApi, createBrowserSession };
