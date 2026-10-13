// Expected input or missing-record failure, translated to HTTP by routes.
class DomainError extends require('../../frontend/js/errors').ApplicationError {
    constructor(payload, status = 400) {
        const category = require('./observability').classifyError(status);
        super(payload.error, { status, category, code: payload.code || (category === 'validation' ? 'VALIDATION_FAILURE' : 'DOMAIN_FAILURE') });
        this.payload = { ...this.payload, ...payload };
    }
}
module.exports = { DomainError };
