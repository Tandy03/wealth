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
  return { ApplicationError, ConflictError, AuthRequiredError, StorageError, ValidationError, RemoteUnavailableError, classify, syncError };
});
