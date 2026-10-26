const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { createI18n } = require('../../frontend/js/i18n');
const { createMobileNavigation } = require('../../frontend/js/navigation/mobile');
const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');

// Localization is a component contract. Financial navigation is covered with
// the complete application in uiSmoke.test.js for web and offline native.
for (const locale of ['en', 'de', 'uk', 'es', 'pl', 'it']) {
  test(`mobile labels and More are localized in ${locale}`, async t => {
    const errors = [], observers = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), { url: 'http://localhost/', virtualConsole });
    const { window } = dom, { document } = window;
    const Observer = window.MutationObserver;
    window.MutationObserver = class extends Observer {
      constructor(callback) { super(callback); observers.push(this); }
    };
    t.after(() => { observers.forEach(observer => observer.disconnect()); window.close(); });
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    window.localStorage.setItem('fino-language', locale);
    document.querySelector('#wallet-app').hidden = false;
    document.querySelector('#investments-app').hidden = true;
    const localization = createI18n({ document, localStorage: window.localStorage, location: window.location, MutationObserver: window.MutationObserver, NodeFilter: window.NodeFilter, charts: { current: null } });
    localization.initializeI18n();
    createMobileNavigation({ window, document, i18n: localization.FinoI18n }).setupMobileNavigation();
    await new Promise(setImmediate);
    const translate = localization.FinoI18n.t;
    assert.equal(document.querySelector('#mobile-bottom-nav').getAttribute('aria-label'), translate('Main navigation'));
    assert.equal(document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').textContent, translate('More'));
    document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();
    assert.equal(document.querySelector('#mobile-more-title').textContent, translate('More'));
    assert.equal(document.querySelector('#mobile-more-sheet').getAttribute('role'), 'menu');
    assert.equal(document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').getAttribute('aria-haspopup'), 'menu');
    assert.equal(document.querySelector('#mobile-more-items button').textContent, translate('Archive'));
    const closed = new Promise(resolve => window.addEventListener('popstate', resolve, { once: true }));
    document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();
    await closed;
    assert.equal(document.querySelector('#mobile-more-backdrop').hidden, true);
    assert.deepEqual(errors, []);
  });
}
