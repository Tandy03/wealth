// Run the financial rule over every UI module without broadening the existing
// incremental general-lint scope. Owners/drafts retain their explicit exclusions.
module.exports = require('../../../eslint.config.cjs').map(config => ({
  ...config,
  rules: Object.fromEntries(Object.entries(config.rules || {}).filter(([name]) => name.startsWith('financial/'))),
}));
