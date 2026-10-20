const { validateFrontend } = require('./frontendContract');
const sources = validateFrontend();
console.log('Reviewed frontend script order and globals: ' + sources.length + ' local scripts.');
