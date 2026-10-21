const test = require('node:test');
const assert = require('node:assert/strict');
const { Linter, ESLint } = require('eslint');
const path = require('node:path');
const rule = require('../scripts/lint/noFinancialStateMutation.cjs');
const linter = new Linter();
function verify(code, options = {}) {
  return linter.verify(code, [{ languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { state: 'readonly', stateStore: 'readonly', store: 'readonly' } },
    plugins: { financial: { rules: { readonly: rule } } }, rules: { 'financial/readonly': ['error', options] } }]);
}
test('static guard rejects direct, aliased, destructured and callback financial writes', () => {
  for (const code of [
    'state.data.assets = [];',
    'state.data.assets[0].amount += 1;',
    'delete state.data.wallet.months.x;',
    'state.data.assets.sort(() => 0);',
    'const data = stateStore.getData(); const assets = data.assets; assets.push({});',
    'const { data: document } = store.getState(); const { payments } = document; payments.splice(0, 1);',
    'const payment = store.getData().payments.find(p => p.id === "a"); payment.received = true;',
    'store.getData().assets.forEach(asset => { asset.quantity++; });',
    'const assets = [...store.getData().assets]; assets[0].quantity = 1;',
    'const assets = store.getData().assets.filter(Boolean); assets.forEach(asset => { asset.name = "x"; });',
    'for (const asset of store.getData().assets) { asset.amount = 1; }',
    'const asset = store.select(snapshot => snapshot.data.assets[0]); asset.price = 1;',
    'function render(snapshot) { Object.assign(snapshot.data.wallet, { loans: [] }); }',
    'Reflect.set(store.getData(), "assets", []);',
    'Object.defineProperty(state, "data", {value: {}});',
    'const { assets: [asset] } = state.data; asset.price = 2;',
    'let asset; asset = stateStore.getData().assets.at(0); asset.name = "x";',
    'FinoWalletActions.normalizeCategories(stateStore.getData().wallet);',
    'const data = store.updateData(draft => {}); data.assets = [];',
    'store.subscribe(({ state: snapshot }) => { snapshot.data.assets.push({}); });',
    'store.subscribe(event => { event.state.data.assets[0].quantity++; });',
    'async function load() { const result = await store.loadData(reader); result.data.assets = []; }',
    'async function save() { const { value } = await store.saveWallet(change, persist); value.expenses.push({}); }',
    'const copy = {...store.getData()}; copy.assets.push({});',
    'const { instruments, ...copy } = store.getData(); copy.assets.push({});',
    'store.selectAssets().push({});',
    'const wallet = store.selectWallet(); wallet.expenses.splice(0, 1);',
    'const assets = [...store.selectAssets()]; assets[0].quantity++;',
    'stateStore.selectPayments(snapshot).forEach(payment => { payment.received = true; });',
  ]) {
    const messages = verify(code);
    assert.ok(messages.some(message => message.ruleId === 'financial/readonly'), 'Not rejected: ' + code);
    assert.ok(messages.every(message => !message.fatal), JSON.stringify(messages));
  }
});
test('UI lint rejects legacy reads, including aliases and destructuring, and accepts named snapshot selectors', () => {
  for (const code of [
    'const assets = state.data.assets;',
    'const current = store.getState(); const rows = current.data.assets;',
    'function render(snapshot) { return snapshot.data.payments; }',
    'const { data: portfolio } = stateStore.getState();',
    'store.subscribe(event => { render(event.state.data); });',
    'stateStore.select(current => current.data.assets);',
  ]) assert.ok(verify(code, { banLegacyReads: true }).some(message => message.messageId === 'legacyRead'), code);
  for (const code of [
    'const assets = stateStore.selectAssets(); const names = assets.map(asset => asset.name);',
    'function render(snapshot) { return store.selectPayments(snapshot).map(payment => payment.amount); }',
    'const data = stateStore.selectData(); render(data);',
    'store.saveWallet(wallet => { wallet.expenses.push({}); }, persist);',
  ]) assert.deepEqual(verify(code, { banLegacyReads: true }), [], code);
});
test('CI config applies the rule to every UI file and excludes only document owners', async () => {
  const eslint = new ESLint({ overrideConfigFile: path.join(__dirname, '../scripts/lint/financialState.config.cjs') });
  for (const filePath of ['frontend/js/controllers/application.js', 'frontend/js/forms/assets.js', 'frontend/js/renderers/wallet.js', 'frontend/js/analytics/dashboard.js']) {
    const [result] = await eslint.lintText('stateStore.getData().assets.push({});', { filePath });
    assert.equal(result.errorCount, 1, filePath);
    assert.equal(result.messages[0].ruleId, 'financial/no-financial-state-mutation');
  }
  for (const filePath of ['frontend/js/state-store.js', 'frontend/js/mobile-api.js']) {
    const config = await eslint.calculateConfigForFile(filePath);
    assert.equal(config.rules?.['financial/no-financial-state-mutation'], undefined);
  }
});
test('static guard permits store commands, pure reads, independent UI fields and local copies', () => {
  for (const code of [
    'stateStore.updateData(draft => { draft.assets.push({}); });',
    'store.saveWallet(wallet => { wallet.expenses.push({}); }, persist);',
    'store.replaceData(response); store.setUI({ portfolioSort: "name" });',
    'const data = store.getData(); const sum = data.assets.reduce((sum, asset) => sum + asset.amount, 0);',
    'const assets = [...store.getData().assets]; assets.sort(compare); assets.push(newAsset);',
    'const assets = store.getData().assets.slice(); assets.reverse();',
    'const amounts = store.getData().assets.map(asset => asset.amount); amounts.sort();',
    'const local = store.getData().assets.map(asset => ({ ...asset })); local[0].quantity = 1;',
    'Object.assign(state, { portfolioSort: "name" }); state.calendarDate = new Date();',
    'function mutation(draft) { draft.assets[0].amount++; }',
    'const data = JSON.parse(JSON.stringify(store.getData())); data.assets = [];',
    'const { walletPlanDrafts } = store.getState(); walletPlanDrafts.x = { value: "2" };',
  ]) assert.deepEqual(verify(code), [], code);
});
