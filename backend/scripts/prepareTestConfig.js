// Clean CI checkouts need the local script reference, never real proxy credentials.
const fs = require('node:fs');
const path = require('node:path');
const target = path.resolve(__dirname, '../../frontend/js/mobile-config.generated.js');
if (!fs.existsSync(target)) {
  fs.writeFileSync(target, 'window.FINO_MOBILE_CONFIG = Object.freeze({});\n', { flag: 'wx', mode: 0o600 });
  console.log('Created empty, test-only mobile configuration.');
} else console.log('Existing local mobile configuration preserved.');
