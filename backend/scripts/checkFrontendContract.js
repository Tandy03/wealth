const { validateFrontend } = require('./frontendContract');
const result = validateFrontend();
console.log('Validated one ESM entry and ' + result.files.length + ' local modules: no cycles, missing exports or browser-global writes.');
