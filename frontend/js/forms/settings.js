(function () {
const state = stateStore.getState();
// forms/settings.js
let noticeResolver = null;

function showNotice(message, title = "Message") {
  message = window.FinoI18n?.t(message) || message;
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
  document.querySelectorAll("[data-drive-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.driveAction;
      const confirmations = {
        download: "Download from Drive and replace the local data file? A backup of the local data will be created first.",
        upload: "Upload local data and replace fino-data.json on Google Drive? A backup of the Drive data will be created first.",
        reconnect: window.mobileApi ? "Disconnect the current Google account? You will choose an account when opening your portfolio again." : "Disconnect the current Google authorization? You will need to run npm run google-auth again.",
      };
      if (confirmations[action] && !(await showConfirm(confirmations[action], "Google Drive"))) return;
      document.querySelectorAll("[data-drive-action]").forEach((item) => { item.disabled = true; });
      document.querySelectorAll("[data-drive-state]").forEach((item) => { item.textContent = "Syncing"; });
      try {
        const result = await api.syncGoogleDrive(action);
        renderGoogleDriveStatus(result.status);
        if (action === "download" || action === "sync") await loadData();
        if (action === "reconnect") await showNotice(
          window.mobileApi ? "Select the Google account whose portfolio you want to open." : "Run npm run google-auth in the project console, then restart the server.",
          "Authorization required",
        );
        else if (action === "backup") await showNotice("Google Drive backup created.");
      } catch (error) {
        await refreshGoogleDriveStatus();
        await showNotice(error.message || "Google Drive operation failed.", "Google Drive");
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
