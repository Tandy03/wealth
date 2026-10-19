// Backend adapter for the same new-operation domain checks used on Android.
const rules = require('../../shared/portfolio/validation');
const { createId } = require('../utils/values');
module.exports = Object.fromEntries(['createTransaction', 'createPayment', 'createNote'].map(method => [method, (data, body) => rules[method](data, body, createId)]));
