// Isolated browser smoke fixture. Never reads real JSON, credentials or Drive.
const express = require('express');
const model = require('../../frontend/js/state-model');
const { createApp } = require('../app');
const { normalizeData } = require('../domain/state');
let data = normalizeData({ ...model.createEmptyState(), assets: [
  { id: 'smoke-stock', name: 'Smoke Stock', type: 'stock', quantity: 2, purchasePrice: 100, currentPrice: 120, purchaseDate: '2026-01-01', currency: 'USD' },
], transactions: [{ id: 'smoke-buy', assetId: 'smoke-stock', type: 'BUY', quantity: 2, amount: 200, date: '2026-01-01', currency: 'USD' }] });
let queue = Promise.resolve();
const repository = {
  readData: async () => structuredClone(data), readLocalData: async () => structuredClone(data),
  saveData: async value => { data = model.normalizeState(value); },
  writeLocalData: async value => { data = model.normalizeState(value); }, initializeStorage: async () => {},
  runMutation(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
  drive: { isEnabled: () => false, getStatus: () => ({ enabled: false, connected: false }) },
};
const app = express();
app.get('/js/mobile-config.generated.js', (_req, res) => res.type('js').send('window.FINO_MOBILE_CONFIG = {};'));
app.get('/api/exchange-rates', (_req, res) => res.json({ rates: { USD: 40, EUR: 45 } }));
app.get('/api/market-data/*path', (_req, res) => res.json({ values: [], currencies: [] }));
app.get('/api/macroeconomics', (_req, res) => res.json({ inflation: {}, gdp: {}, exchangeRates: [] }));
app.get('/api/macroeconomics/policy-rate', (_req, res) => res.json({ policyRate: [] }));
app.use(createApp({ repository }));
const server = app.listen(Number(process.env.FINO_SMOKE_PORT || 4317), '127.0.0.1', () => console.log('UI smoke fixture: http://127.0.0.1:' + server.address().port));
