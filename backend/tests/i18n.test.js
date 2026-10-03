const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/i18n.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
const flush = () => new Promise(setImmediate);
async function setup(t, locale) {
  const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  window.localStorage.setItem('fino-language', locale);
  window.Chart = class { constructor(canvas, config) { this.config = config; } };
  window.eval(source.replace('  const dictionaries =', '  window.__translationRows = rows;\n  const dictionaries ='));
  await flush();
  return window;
}
test('all static interface labels have translations in every language', async t => {
  const permitted = new Set(['fino', 'FINO', 'S&P 500', 'Google Drive', 'USD', 'EUR', 'UAH', 'USD — $', 'EUR — €', 'UAH — ₴', 'USD/UAH', 'EUR/USD · Frankfurter', 'USD/EUR · Frankfurter', 'Twelve Data', 'Dow Jones Industrial Average', 'Inzhur REIT', 'S1 REIT', 'Inzhur MilTech', 'NovaPay', 'ETF', 'ISIN', 'ROI', 'XIRR', 'English', 'Deutsch', 'Español', 'Polski', 'Italiano', 'Inter', 'Roboto', 'Montserrat', 'Oswald', 'DM Sans', 'Comic Relief']);
  const original = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  t.after(() => original.window.close());
  const walker = original.window.document.createTreeWalker(original.window.document.body, 4);
  const labels = new Set();
  while (walker.nextNode()) {
    const value = walker.currentNode.nodeValue.trim();
    if (/[a-zA-Z]{3}/.test(value) && !permitted.has(value)) labels.add(value);
  }
  for (const element of original.window.document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      const value = element.getAttribute(attribute);
      if (value && /[a-zA-Z]{3}|e\.g\./.test(value) && !permitted.has(value)) labels.add(value);
    }
  }
  for (const locale of ['de', 'uk', 'es', 'pl', 'it']) {
    const window = await setup(t, locale);
    for (const row of window.__translationRows) {
      assert.equal(row.length, 6, row[0]);
      assert.ok(row.every(value => typeof value === 'string' && value.trim()), row[0]);
    }
    for (const label of labels) assert.ok(window.__translationRows.some(row => row[0] === label) || window.FinoI18n.t(label) !== label, `${locale}: ${label}`);
    // Ukrainian has no identical English UI phrases beyond the terms allowed above.
    if (locale === 'uk') for (const label of labels) assert.notEqual(window.FinoI18n.t(label), label, `${locale}: ${label}`);
    assert.equal(window.document.documentElement.lang, locale);
    assert.notEqual(window.FinoI18n.t('Income and realized profit by month'), 'Income and realized profit by month');
    assert.notEqual(window.FinoI18n.t('Average monthly profit: —'), 'Average monthly profit: —');
    assert.notEqual(window.FinoI18n.t('Last sync: —'), 'Last sync: —');
    assert.notEqual(window.FinoI18n.t('Failed to save asset.'), 'Failed to save asset.');
  }
});
test('dynamic roots, changed attributes, chart callbacks and protected user text', async t => {
  const window = await setup(t, 'uk');
  const { document } = window;
  const element = document.createElement('button');
  element.setAttribute('aria-label', 'Delete loan');
  element.innerHTML = 'Saving...<span translate="no">Stock · Received units</span>';
  document.body.append(element);
  await flush();
  assert.equal(element.getAttribute('aria-label'), 'Видалити позику');
  assert.match(element.textContent, /^Збереження…/);
  assert.equal(element.querySelector('span').textContent, 'Stock · Received units');
  element.setAttribute('aria-label', 'Delete note');
  await flush();
  assert.equal(element.getAttribute('aria-label'), 'Видалити нотатку');
  const chart = new window.Chart(null, { data: { datasets: [{ label: 'Money earned' }] }, options: { plugins: { tooltip: { callbacks: { label: () => 'Money earned: 100 ₴' } } } } });
  assert.equal(chart.config.data.datasets[0].label, 'Зароблено');
  assert.equal(chart.config.options.plugins.tooltip.callbacks.label(), 'Зароблено: 100 ₴');
  assert.equal(window.FinoI18n.t('ACME Received units'), 'ACME Received units');
  assert.equal(window.FinoI18n.t('Drive upload failed (403)'), 'Вивантаження в Drive не вдалося (403)');
  assert.equal(window.FinoI18n.t('You cannot sell 10 units. Only 2 units are available.'), 'Неможливо продати 10 од.; доступно: 2.');
  assert.equal(document.querySelector('#portfolio-history-mode').parentElement.querySelector('span'), null);
});
