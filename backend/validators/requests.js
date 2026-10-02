module.exports = require('../../frontend/js/validation')({
  DomainError: require('../utils/domainError').DomainError,
  isValidDateString: require('./index').isValidDateString,
  constants: require('../config/constants'),
});
