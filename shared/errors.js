(function (root, factory) {
  const errors = factory();
  if (typeof module === 'object' && module.exports) module.exports = errors;
  else root.FinoErrors = errors;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class ApplicationError extends Error {
    constructor(message, { code = 'INTERNAL_ERROR', category = 'internal_error', status = 500, cause, details = {} } = {}) {
      super(message); this.name = this.constructor.name;
      Object.assign(this, { code, category, status, payload: { error: message, code, category, ...details } });
      if (cause) this.cause = cause;
    }
  }
  const errorClass = (code, category, status, message) => class extends ApplicationError {
    constructor(options = {}) { super(options.message || message, { code, category, status, ...options }); this.name = category.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('') + 'Error'; }
  };
  const ConflictError = errorClass('SYNC_CONFLICT', 'conflict', 409, 'Local and remote changes conflict. Choose which version to keep; both copies are preserved.');
  const AuthRequiredError = errorClass('AUTHORIZATION_REQUIRED', 'auth_required', 401, 'Google Drive authorization is required.');
  const StorageError = errorClass('STORAGE_FAILURE', 'storage_failure', 503, 'Could not save local data. Your previous saved data has been preserved.');
  const ValidationError = errorClass('VALIDATION_FAILURE', 'validation', 400, 'Invalid financial data.');
  const RemoteUnavailableError = errorClass('REMOTE_UNAVAILABLE', 'remote_unavailable', 502, 'Google Drive or the external provider is unavailable. Changes remain saved locally.');
  const defaults = {
    validation: [400, 'VALIDATION_FAILURE', 'Invalid financial data.'],
    auth_required: [401, 'AUTHORIZATION_REQUIRED', 'Google Drive authorization is required.'],
    access_denied: [403, 'ACCESS_DENIED', 'Access to this API is denied.'],
    not_found: [404, 'NOT_FOUND', 'API resource not found.'],
    conflict: [409, 'SYNC_CONFLICT', 'Local and remote changes conflict. Choose which version to keep; both copies are preserved.'],
    storage_failure: [503, 'STORAGE_FAILURE', 'Could not save local data. Your previous saved data has been preserved.'],
    remote_unavailable: [502, 'REMOTE_UNAVAILABLE', 'The external provider is unavailable. Try again later.'],
    internal_error: [500, 'INTERNAL_ERROR', 'Internal server error.'],
  };
  function categoryForStatus(status) {
    return ({ 400: 'validation', 401: 'auth_required', 403: 'access_denied', 404: 'not_found', 409: 'conflict',
      413: 'validation', 415: 'validation', 422: 'validation', 429: 'remote_unavailable', 502: 'remote_unavailable',
      503: 'storage_failure', 504: 'remote_unavailable' })[status] || 'internal_error';
  }
  const safeCode = (value, fallback) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : fallback;
  const safeRequestId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
  const normalizedErrors = new WeakSet();
  function safeMessage(value, fallback) {
    // Only explicitly public errors reach this function. Still reject accidental diagnostics.
    return typeof value === 'string' && value.length > 0 && value.length <= 600 &&
      !/https?:\/\/|[A-Za-z]:[\\/]|\\\\|(?:^|[\s'"])\/(?:[\w.-]+\/)+|\bBearer\s+|\b(?:access_token|refresh_token|client_secret|id_token|authorization|password|token)["']?\s*[:=]|\{\s*"|-----BEGIN|[<>]|\n\s*at\s/i.test(value)
      ? value : fallback;
  }
  function publicError(error, { trusted = false, fallbackCategory = 'internal_error' } = {}) {
    const known = trusted || error instanceof ApplicationError;
    const base = Object.hasOwn(defaults, fallbackCategory) ? fallbackCategory : 'internal_error';
    const status = known && Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : defaults[base][0];
    const category = known && Object.hasOwn(defaults, error?.category) ? error.category : categoryForStatus(status);
    const [, fallbackCode, fallbackMessage] = defaults[category];
    const payload = {
      error: category === 'internal_error' ? fallbackMessage : known ? safeMessage(error?.message, fallbackMessage) : fallbackMessage,
      code: known ? safeCode(error?.code, fallbackCode) : fallbackCode, category,
    };
    // Compatibility: sync failures expose save outcomes, never an arbitrary snapshot.
    const sync = known && error?.payload?.status;
    if (sync && typeof sync === 'object' && !Array.isArray(sync)) {
      payload.status = {};
      if (['local-saved', 'sync-pending', 'sync-confirmed', 'conflict', 'auth-required'].includes(sync.state)) payload.status.state = sync.state;
      for (const key of ['enabled', 'connected', 'syncing', 'savedLocally', 'savedRemotely', 'backupSaved', 'pendingUpload', 'remoteConfirmed', 'conflict', 'authorizationRequired']) {
        if (typeof sync[key] === 'boolean') payload.status[key] = sync[key];
      }
    }
    return { status, payload };
  }
  function clientError(error, options = {}) {
    if (error && typeof error === 'object' && normalizedErrors.has(error)) return error;
    const { status, payload } = publicError(error, options);
    const result = new ApplicationError(payload.error, { status, code: payload.code, category: payload.category,
      details: payload.status ? { status: payload.status } : {} });
    result.requestId = safeRequestId(error?.requestId) || (globalThis.crypto?.randomUUID?.() ?? 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    result.details = payload.status || null;
    normalizedErrors.add(result);
    return result;
  }
  function diagnostics(error) {
    return { code: safeCode(error?.code, 'INTERNAL_ERROR'), category: Object.hasOwn(defaults, error?.category) ? error.category : 'internal_error',
      status: Number.isInteger(error?.status) ? error.status : 500, requestId: safeRequestId(error?.requestId) };
  }
  function displayMessage(error, i18n) {
    const message = safeMessage(error?.message || error?.error, defaults.internal_error[2]);
    const translated = i18n?.t(message) || message;
    const requestId = safeRequestId(error?.requestId);
    return requestId ? translated + '\n' + (i18n?.format('Request ID: {value}', { value: requestId }) || 'Request ID: ' + requestId) : translated;
  }
  function classify(error) {
    const code = error?.code, status = Number(error?.status || error?.response?.status || code);
    if (['SYNC_CONFLICT', 'GOOGLE_DRIVE_CONFLICT'].includes(code) || [409, 412].includes(status)) return 'conflict';
    if (['AUTHORIZATION_REQUIRED', 'GOOGLE_AUTH_REQUIRED'].includes(code) || status === 401) return 'auth_required';
    if (error?.category) return error.category;
    return 'remote_unavailable';
  }
  function syncError(error) {
    if (error instanceof ApplicationError) return error;
    const category = classify(error);
    const Type = category === 'conflict' ? ConflictError : category === 'auth_required' ? AuthRequiredError : RemoteUnavailableError;
    return new Type({ cause: error });
  }
  return { ApplicationError, ConflictError, AuthRequiredError, StorageError, ValidationError, RemoteUnavailableError, classify, syncError,
    categoryForStatus, safeCode, safeRequestId, publicError, clientError, diagnostics, displayMessage };
});
