(function () {
const state = stateStore.getState();
// forms/settings.js
let noticeResolver = null;

function showNotice(message, title = "Message") {
  message = message && typeof message === 'object' ? window.FinoErrors.displayMessage(message, window.FinoI18n) : window.FinoI18n?.t(message) || message;
  title = window.FinoI18n?.t(title) || title;
  const modal = document.querySelector("#notice-modal");
  if (!modal) return Promise.resolve(true);
  document.querySelector("#notice-title").textContent = title;
  document.querySelector("#notice-message").textContent = String(message || "");
  document.querySelector("#notice-cancel").hidden = true;
  modal.classList.add("open");
  return new Promise((resolve) => { noticeResolver = resolve; });
}

function showConfirm(message, title = "Please confirm") {
  const promise = showNotice(message, title);
  document.querySelector("#notice-cancel").hidden = false;
  return promise;
}

function setupNoticeModal() {
  const modal = document.querySelector("#notice-modal");
  const close = (result) => { modal?.classList.remove("open"); noticeResolver?.(result); noticeResolver = null; };
  document.querySelector("#notice-ok")?.addEventListener("click", () => close(true));
  document.querySelector("#notice-cancel")?.addEventListener("click", () => close(false));
  document.querySelector("#close-notice-modal")?.addEventListener("click", () => close(false));
}

function setupModalBackdropClosing() {
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target !== backdrop) return;
      const closeButton = backdrop.querySelector(".modal-header .icon-btn");
      if (closeButton) closeButton.click();
      else backdrop.classList.remove("open");
    });
  });
}

function setupGoogleDriveSync() {
  let comparing = false;
  const previewModal = document.querySelector('#sync-preview-modal');
  const compareVersions = async action => {
    const preview = await api.getSyncConflictPreview();
    const text = value => window.FinoI18n?.t(value) || value;
    const e = escapeHtml;
    const date = value => value ? new Date(value).toLocaleString(window.FinoI18n?.locale || 'en') : text('Unknown');
    const countLabels = { assets: 'Assets', transactions: 'Transactions', sales: 'Sales', payments: 'Payments', receivedPayments: 'Received payments', expenses: 'Expenses', loans: 'Loans', notes: 'Notes' };
    const card = (title, version) => `<article><h3>${e(text(title))}</h3>${version ? `<p>${e(text('Updated'))}: ${e(date(version.updatedAt))}<br>${e(text('Device'))}: ${e(version.deviceId || text('Unknown'))}<br>${e(text('Revision'))}: ${e(version.revision ?? text('Unknown'))}</p><dl>${Object.entries(version.counts).map(([key, value]) => `<dt>${e(text(countLabels[key] || key))}</dt><dd>${e(value)}</dd>`).join('')}</dl>` : `<p>${e(text('No cloud document found.'))}</p>`}</article>`;
    document.querySelector('#sync-preview-versions').innerHTML = card('This device', preview.local) + card('Google Drive', preview.remote);
    document.querySelector('#sync-preview-differences').innerHTML = Object.entries(preview.differences).map(([key, diff]) => `<p><strong>${e(text(countLabels[key] || key))}</strong>: ${e(window.FinoI18n.format('Only on device: {local}; only in Drive: {remote}; different: {changed}', { local: diff.localOnly, remote: diff.remoteOnly, changed: diff.changed }))}</p>`).join('')
      + (preview.plansDiffer ? `<p>${e(text('Budget plans differ.'))}</p>` : '') + (preview.targetsDiffer ? `<p>${e(text('Rebalance targets differ.'))}</p>` : '')
      + `<p>${e(text('Budget plans and rebalance targets are also replaced with the selected document.'))}</p>`;
    const choices = [...previewModal.querySelectorAll('[name="sync-version"]')];
    choices.forEach(input => { input.disabled = input.value === 'download' && !preview.remote; input.checked = input.value === action && !input.disabled; });
    const consequence = () => {
      const selected = choices.find(input => input.checked)?.value;
      document.querySelector('#sync-preview-consequence').textContent = text(!selected ? 'Choose a version to see the consequences before confirming.' : selected === 'upload'
        ? 'Google Drive will be replaced with this device’s document. Cloud-only records will not remain in the active portfolio. A cloud backup is created before replacement.'
        : 'This device’s document will be replaced with Google Drive. Local-only records will not remain in the active portfolio. A local recovery copy and backup are created before replacement.');
      document.querySelector('#confirm-sync-preview').disabled = !selected;
    };
    choices.forEach(input => { input.onchange = consequence; }); consequence();
    const previousFocus = document.activeElement;
    previewModal.classList.add('open');
    previewModal.querySelector('.modal').scrollTop = 0;
    document.querySelector('#close-sync-preview').focus();
    return new Promise(resolve => {
      const close = accepted => {
        previewModal.classList.remove('open');
        previewModal.removeEventListener('click', clicked); previewModal.removeEventListener('keydown', keyed);
        choices.forEach(input => { input.onchange = null; }); previousFocus?.focus();
        resolve(accepted ? { action: choices.find(input => input.checked).value, options: { previewToken: preview.token } } : null);
      };
      const clicked = event => {
        if (event.target === previewModal || event.target.closest('#cancel-sync-preview,#close-sync-preview')) close(false);
        else if (event.target.closest('#confirm-sync-preview') && choices.some(input => input.checked)) close(true);
      };
      const keyed = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(false); }
        if (event.key === 'Tab') {
          const focusable = [...previewModal.querySelectorAll('button:not(:disabled),input:not(:disabled)')], first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      previewModal.addEventListener('click', clicked); previewModal.addEventListener('keydown', keyed);
    });
  };
  document.querySelectorAll("[data-drive-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (comparing) return;
      let action = button.dataset.driveAction, options = {};
      const confirmations = {
        reconnect: window.mobileApi ? "Disconnect the current Google account? You will choose an account when opening your portfolio again." : "Disconnect the current Google authorization? You will need to run npm run google-auth again.",
      };
      if (['upload', 'download', 'compare'].includes(action)) {
        comparing = true;
        try { const decision = await compareVersions(action); if (!decision) return; ({ action, options } = decision); }
        catch (error) { await showNotice(error, 'Google Drive'); return; }
        finally { comparing = false; }
      } else if (confirmations[action] && !(await showConfirm(confirmations[action], "Google Drive"))) return;
      document.querySelectorAll("[data-drive-action]").forEach((item) => { item.disabled = true; });
      document.querySelectorAll("[data-drive-state]").forEach((item) => { item.textContent = "Syncing"; });
      try {
        if (action === 'reconnect') stateStore.invalidateContext();
        const result = await api.syncGoogleDrive(action, options);
        renderGoogleDriveStatus(result.status);
        if (action === "download" || action === "sync") await loadData();
        if (action === "reconnect") await showNotice(
          window.mobileApi ? "Select the Google account whose portfolio you want to open." : "Run npm run google-auth in the project console, then restart the server.",
          "Authorization required",
        );
        else if (action === "backup") await showNotice("Google Drive backup created.");
      } catch (error) {
        await refreshGoogleDriveStatus();
        await showNotice(error || "Google Drive operation failed.", "Google Drive");
      } finally {
        await refreshGoogleDriveStatus();
      }
    });
  });
  refreshGoogleDriveStatus();
  window.setInterval(refreshGoogleDriveStatus, 15000);
}

function setupSettingsModal() {
  const modal = document.querySelector("#settings-modal");
  const close = () => modal?.classList.remove("open");
  document.querySelectorAll("[data-open-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      modal?.classList.add("open");
      const content = modal?.querySelector(".settings-modal");
      if (content) content.scrollTop = 0;
      refreshGoogleDriveStatus();
    });
  });
  document.querySelector("#close-settings-modal")?.addEventListener("click", close);
  document.querySelector("#settings-logout")?.addEventListener("click", () => showNotice("Log out is not available yet.", "Account"));
}

function setupThemeToggle() {
  const themeSelect = document.querySelector("#settings-theme-select");
  const fontSelect = document.querySelector("#settings-font-select");
  const languageSelect = document.querySelector("#settings-language-select");
  const biometricControl = document.querySelector("#settings-biometric-control");
  const biometricToggle = document.querySelector("#settings-biometric-toggle");
  const biometricStatus = document.querySelector("#settings-biometric-status");
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  const appLock = isNative ? window.Capacitor?.Plugins?.AppLock : null;
  const themes = ["dark", "light", "monochromatic", "analog"];
  const fonts = ["inter", "montserrat", "roboto", "mono", "oswald", "comic-relief", "dm-sans"];
  const savedTheme = localStorage.getItem("investment-tracker-theme") || "dark";
  const savedFont = localStorage.getItem("investment-tracker-font") || "inter";

  document.documentElement.dataset.theme = themes.includes(savedTheme) ? savedTheme : "dark";
  document.documentElement.dataset.font = fonts.includes(savedFont) ? savedFont : "inter";
  delete document.documentElement.dataset.textSize;
  localStorage.removeItem("investment-tracker-text-size");
  if (themeSelect) themeSelect.value = document.documentElement.dataset.theme;
  if (fontSelect) fontSelect.value = document.documentElement.dataset.font;
  if (languageSelect) languageSelect.value = window.FinoI18n?.locale || "en";
  if (appLock) {
    biometricControl.hidden = false;
    appLock.setTheme({ theme: document.documentElement.dataset.theme }).catch(() => {});
    appLock.getSettings().then((settings) => {
      biometricToggle.checked = Boolean(settings.biometricEnabled && settings.biometricAvailable);
      biometricToggle.disabled = !settings.biometricAvailable;
      if (!settings.biometricAvailable) biometricStatus.textContent = "Biometric authentication is not available on this device";
    }).catch(() => {
      biometricToggle.disabled = true;
      biometricStatus.textContent = "Biometric settings are unavailable";
    });
  }

  themeSelect?.addEventListener("change", () => {
    document.documentElement.dataset.theme = themeSelect.value;
    localStorage.setItem("investment-tracker-theme", themeSelect.value);
    appLock?.setTheme({ theme: themeSelect.value }).catch(() => {});
    renderProfitCalculator();
    renderRebalanceCalculator();
    if (document.querySelector("#wallet-charts")?.classList.contains("active")) renderWalletCharts();
  });
  fontSelect?.addEventListener("change", () => {
    document.documentElement.dataset.font = fontSelect.value;
    localStorage.setItem("investment-tracker-font", fontSelect.value);
  });
  languageSelect?.addEventListener("change", () => {
    window.FinoI18n?.setLanguage(languageSelect.value);
  });
  biometricToggle?.addEventListener("change", () => {
    appLock?.setBiometricEnabled({ enabled: biometricToggle.checked }).catch(() => {
      biometricToggle.checked = !biometricToggle.checked;
    });
  });
}
Object.assign(window, { showNotice, showConfirm, setupNoticeModal, setupModalBackdropClosing, setupGoogleDriveSync, setupSettingsModal, setupThemeToggle });
})();
