// Expected input or missing-record failure, translated to HTTP by routes.
class DomainError extends Error {
    constructor(payload, status = 400) {
        super(payload.error);
        this.payload = payload;
        this.status = status;
        this.category = require('./observability').classifyError(status);
    }
}
module.exports = { DomainError };
