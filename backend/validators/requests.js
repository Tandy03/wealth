const rules = require('../../shared/validation')({
  DomainError: require('../utils/domainError').DomainError,
  isValidDateString: require('./index').isValidDateString,
  constants: require('../config/constants'),
});

// Transport-only guards. Domain services also validate raw operations independently.
function validateHttpRequest(req, _res, next) {
  try {
    rules.validateApiQuery(req.path, req.query);
    if (req.body !== undefined) require('../../shared/state-model').validateJson(req.body);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)))
      throw new (require('../utils/domainError').DomainError)({ error: 'request body must be an object.' });
    if (req.path === '/api/assets/merge') rules.validateRequest('merge', req.body);
    if (['/api/google-drive/sync', '/api/sync/google-drive'].includes(req.path)) {
      for (const key of ['action', 'direction']) if (req.body?.[key] !== undefined) rules.validateSyncAction(req.body[key]);
      if (req.body?.action && req.body?.direction && req.body.action !== req.body.direction)
        throw new (require('../utils/domainError').DomainError)({ error: 'Invalid sync direction.' });
      rules.validateSyncOptions(req.body?.action || req.body?.direction || 'sync', req.body?.previewToken === undefined ? {} : { previewToken: req.body.previewToken });
    }
    next();
  } catch (error) { next(error); }
}
module.exports = { ...rules, validateHttpRequest };
