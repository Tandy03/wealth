const path = require('node:path');
const { prepareAssets } = require('./mobileAssets');
const { entries } = prepareAssets(path.resolve(__dirname, '../..'));
console.log(`Prepared ${entries.length} compiled local resources. No Android sync or APK build was run.`);
