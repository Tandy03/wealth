const { ApplicationError, RemoteUnavailableError, publicError, safeCode, safeRequestId } = require('../../shared/errors');
const { DomainError } = require('./domainError');

// Endpoint-specific provider context, without forwarding provider messages or bodies.
function externalFailure(error, { message, code = 'REMOTE_UNAVAILABLE', status } = {}) {
  if (error instanceof ApplicationError) return error;
  const providerStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 502;
  return new RemoteUnavailableError({ message, code: safeCode(error?.code, code), status: status || providerStatus });
}

function errorHandler(error, req, res, next) {
  // Delegate aborting a started response to Express. Its default logger must not
  // receive the original exception (which can contain tokens/provider bodies).
  if (res.headersSent) {
    const failure = new Error('Request failed after response headers were sent.');
    const requestId = safeRequestId(res.getHeader?.('X-Request-Id'));
    failure.stack = failure.message + (requestId ? ' Request ID: ' + requestId : '');
    return next(failure);
  }
  if (error?.type === 'entity.parse.failed') error = new DomainError({ error: 'Request body must be valid JSON.', code: 'INVALID_JSON' }, 400);
  else if (error?.type === 'entity.too.large') error = new DomainError({ error: 'Request body is too large.', code: 'REQUEST_TOO_LARGE' }, 413);
  const { status, payload } = publicError(error);
  // observeApi records the completed failure once, including the request ID.
  res.status(status).json(payload);
}

module.exports = { externalFailure, errorHandler };
