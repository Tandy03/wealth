// One mobile view over the existing navigation buttons. No financial state or API.
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  portfolio: '<path d="M10 3a9 9 0 1 0 11 11H10Z"/><path d="M14 3v7h7a9 9 0 0 0-7-7Z"/>',
  transactions: '<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
  analytics: '<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 11h18m-13 4h1m3 0h1m3 0h1m-9 3h1m3 0h1"/>',
  rebalance: '<path d="M5 4v16M12 4v16M19 4v16"/><rect x="3" y="7" width="4" height="4" rx="1"/><rect x="10" y="13" width="4" height="4" rx="1"/><rect x="17" y="6" width="4" height="4" rx="1"/>',
  market: '<path d="m3 17 6-6 4 4 8-10M16 5h5v5"/>',
  macro: '<path d="M4 20h16M6 17v-5m6 5V7m6 10V4"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8m-10 5h6"/>',
  loans: '<path d="M3 8h18M5 8v11m7-11v11m7-11v11M3 21h18M2 8l10-6 10 6"/>',
};
const svg = icon => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg>`;
export const navigationModes = {
  investment: {
    selector: '#investments-app .nav-item[data-section]', attribute: 'section',
    primary: [['dashboard','Dashboard','home'], ['analytics','Analytics','analytics'], ['market','Market','market'], ['macroeconomics','Macroeconomics','macro']],
    more: [['calendar','Calendar','calendar'], ['portfolio','Portfolio','portfolio'], ['transactions','Transactions','transactions'], ['rebalance','Rebalance','rebalance']],
  },
  wallet: {
    selector: '#wallet-app .wallet-tab[data-wallet-tab]', attribute: 'walletTab',
    primary: [['current','Current','home'], ['expenses','Recorded expenses','transactions'], ['charts','Analytics','analytics'], ['loans','Loans','loans']],
    more: [['archive','Archive','archive']],
  },
};

export function createMobileNavigation({ window, document, i18n }) {
  let initialized = false, mode = null, route = null, opened = false, closing = false;
  let marker = null, completion = null, previousFocus = null;
  let bar, backdrop, sheet, items, moreButton;
  const compact = window.matchMedia('(max-width: 700px)');
  const t = text => i18n.t(text);
  const currentMode = () => document.querySelector('#wallet-app')?.hidden === false ? 'wallet' : 'investment';
  const controls = activeMode => [...document.querySelectorAll(navigationModes[activeMode].selector)];
  const currentRoute = activeMode => controls(activeMode).find(button => button.classList.contains('active'))?.dataset[navigationModes[activeMode].attribute] || navigationModes[activeMode].primary[0][0];
  const available = (activeMode, id) => controls(activeMode).find(button => button.dataset[navigationModes[activeMode].attribute] === id);
  function buttonFor([id, label, icon], extra = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.mobileRoute = id;
    button.className = extra ? 'mobile-more-item' : 'mobile-nav-button';
    if (extra) { button.setAttribute('role', 'menuitem'); button.tabIndex = -1; }
    button.innerHTML = `<span class="mobile-nav-icon">${svg(icon)}</span><span class="mobile-nav-label"></span>`;
    button.querySelector('.mobile-nav-label').textContent = t(label);
    button.setAttribute('aria-label', t(label));
    return button;
  }
  function updateHeight() {
    if (!compact.matches) return;
    const height = bar.getBoundingClientRect().height;
    if (height > 0) document.documentElement.style.setProperty('--mobile-nav-height', `${height}px`);
    if (opened && moreButton) {
      const anchor = moreButton.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = Math.min(anchor.top, viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
      backdrop.style.setProperty('--mobile-menu-right', `${Math.max(12, window.innerWidth - anchor.right)}px`);
      backdrop.style.setProperty('--mobile-menu-bottom', `${window.innerHeight - top + 10}px`);
      backdrop.style.setProperty('--mobile-menu-height', `${Math.max(0, top - (viewport?.offsetTop || 0) - 24)}px`);
      backdrop.style.setProperty('--mobile-menu-arrow-right', `${Math.max(12, anchor.width / 2 - 5)}px`);
      backdrop.style.setProperty('--mobile-menu-overlay-bottom', `${Math.max(0, window.innerHeight - bar.getBoundingClientRect().top)}px`);
    }
  }
  function paint() {
    const activeMode = currentMode(), selected = currentRoute(activeMode);
    if (mode !== activeMode) {
      mode = activeMode;
      const config = navigationModes[mode];
      const buttons = config.primary.filter(([id]) => available(mode, id)).map(item => buttonFor(item));
      if (config.more.some(([id]) => available(mode, id))) {
        moreButton = buttonFor(['more','More','more']);
        moreButton.setAttribute('aria-haspopup', 'menu');
        moreButton.setAttribute('aria-controls', 'mobile-more-sheet');
        moreButton.setAttribute('aria-expanded', String(opened));
        buttons.push(moreButton);
      } else moreButton = null;
      bar.replaceChildren(...buttons);
      bar.style.setProperty('--mobile-nav-columns', String(buttons.length));
      bar.dataset.mode = mode;
      items.replaceChildren(...config.more.filter(([id]) => available(mode, id)).map(item => buttonFor(item, true)));
      document.querySelector('#mobile-more-title').textContent = t('More');
    }
    route = selected;
    const extra = navigationModes[mode].more.some(([id]) => id === route);
    for (const button of [...bar.querySelectorAll('[data-mobile-route]'), ...items.querySelectorAll('[data-mobile-route]')]) {
      const active = button.dataset.mobileRoute === route || button === moreButton && extra;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    updateHeight();
  }
  function hideSheet({ focus = true } = {}) {
    if (!opened) return;
    opened = false; backdrop.hidden = true;
    moreButton?.setAttribute('aria-expanded', 'false');
    moreButton?.classList.remove('is-open');
    if (focus) {
      const target = compact.matches ? moreButton : controls(currentMode()).find(button => button.classList.contains('active'));
      (target || previousFocus)?.focus({ preventScroll: true });
    }
  }
  function closeSheet(after = null, focus = true) {
    if (!opened || closing) return;
    hideSheet({ focus });
    if (marker && window.history.state?.finoMobileMore === marker) {
      closing = true; completion = after;
      window.history.back();
    } else { marker = null; after?.(); }
  }
  function openSheet() {
    if (!compact.matches || opened || closing || !moreButton || document.querySelector('.modal-backdrop.open')) return;
    previousFocus = document.activeElement;
    marker = `fino-more-${Date.now()}`;
    window.history.pushState({ ...window.history.state, finoMobileMore: marker }, '', window.location.href);
    opened = true; backdrop.hidden = false;
    moreButton.setAttribute('aria-expanded', 'true'); moreButton.classList.add('is-open');
    updateHeight();
    items.querySelector('button.active, button')?.focus({ preventScroll: true });
  }
  function select(id) {
    const activeMode = mode;
    const navigate = () => { if (currentMode() === activeMode) { available(activeMode, id)?.click(); paint(); moreButton?.focus({ preventScroll: true }); } };
    if (opened) closeSheet(navigate, false);
    else { available(activeMode, id)?.click(); paint(); }
  }
  function setupMobileNavigation() {
    if (initialized) return; initialized = true;
    bar = document.querySelector('#mobile-bottom-nav'); backdrop = document.querySelector('#mobile-more-backdrop');
    sheet = document.querySelector('#mobile-more-sheet'); items = document.querySelector('#mobile-more-items');
    if (!bar || !backdrop || !sheet || !items) throw new Error('Mobile navigation markup is missing.');
    document.querySelectorAll('[data-open-settings]').forEach(button => button.setAttribute('aria-label', t('Settings')));
    bar.addEventListener('click', event => {
      const button = event.target.closest('[data-mobile-route]'); if (!button) return;
      if (button.dataset.mobileRoute === 'more') { if (opened) closeSheet(); else openSheet(); }
      else if (opened) closeSheet(() => select(button.dataset.mobileRoute), false);
      else select(button.dataset.mobileRoute);
    });
    items.addEventListener('click', event => { const button = event.target.closest('[data-mobile-route]'); if (button) select(button.dataset.mobileRoute); });
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeSheet(); });
    document.addEventListener('keydown', event => {
      if (!opened) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSheet(); }
      if (event.key === 'Tab') { closeSheet(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...sheet.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    window.addEventListener('popstate', () => {
      if (window.history.state?.finoMobileMore === marker) return;
      const after = completion; completion = null; closing = false; marker = null;
      hideSheet({ focus: !after }); after?.();
    });
    const observer = new window.MutationObserver(() => {
      const activeMode = currentMode(), selected = currentRoute(activeMode);
      if (mode !== activeMode && opened) closeSheet(null, false);
      if (mode !== activeMode || route !== selected) paint();
    });
    function observeNavigation() {
      observer.disconnect();
      if (!compact.matches) return;
      document.querySelectorAll('.app-shell, .app-shell .nav-item, .app-shell .page-section').forEach(element => observer.observe(element, { attributes: true, attributeFilter: element.classList.contains('app-shell') ? ['hidden'] : ['class'] }));
      paint();
    }
    compact.addEventListener?.('change', () => {
      if (!compact.matches) { closeSheet(); document.documentElement.style.removeProperty('--mobile-nav-height'); }
      observeNavigation();
    });
    window.addEventListener('resize', updateHeight, { passive: true });
    window.visualViewport?.addEventListener('resize', updateHeight, { passive: true });
    window.visualViewport?.addEventListener('scroll', updateHeight, { passive: true });
    if (window.ResizeObserver) new window.ResizeObserver(updateHeight).observe(bar);
    observeNavigation();
  }
  return { setupMobileNavigation };
}
