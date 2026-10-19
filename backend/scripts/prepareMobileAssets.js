const path = require('node:path');
const { prepareAssets } = require('./mobileAssets');
const { entries } = prepareAssets(path.resolve(__dirname, '../..'));
console.log(`Prepared ${entries.length} local web/shared resources. No Android sync or APK build was run.`);
