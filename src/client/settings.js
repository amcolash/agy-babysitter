import { term, handleTerminalResize, isMobileDevice, getSavedTerminalFontSize, saveTerminalFontSize } from './terminal.js';

const SETTINGS_KEY = 'agy_app_settings';

const DEFAULT_FONT_STACK = '"SauceCodePro Nerd Font Mono", "SauceCodePro Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const FONT_MAP = {
  'SauceCodePro Nerd Font Mono': DEFAULT_FONT_STACK,
  'JetBrains Mono, monospace': 'JetBrains Mono, "SauceCodePro Nerd Font Mono", monospace',
  'Fira Code, monospace': 'Fira Code, "SauceCodePro Nerd Font Mono", monospace',
  'Cascadia Code, monospace': 'Cascadia Code, "SauceCodePro Nerd Font Mono", monospace',
  'Menlo, Monaco, Consolas, monospace': 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  'ui-monospace, monospace': 'ui-monospace, SFMono-Regular, monospace'
};

const DEFAULT_SETTINGS = {
  soundEnabled: false,
  vibrationEnabled: true,
  cursorStyle: 'bar', // 'bar' (I-beam), 'block', 'underline'
  cursorBlink: true,
  fontFamily: 'SauceCodePro Nerd Font Mono'
};

let currentSettings = { ...DEFAULT_SETTINGS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
  return currentSettings;
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
  } catch (e) {}
}

export function getSetting(key) {
  if (key in currentSettings) {
    return currentSettings[key];
  }
  return DEFAULT_SETTINGS[key];
}

export function updateSetting(key, value) {
  currentSettings[key] = value;
  saveSettings();
  applySettingsToTerminal();
}

export function applySettingsToTerminal() {
  if (!term) return;

  // Cursor Style
  const style = currentSettings.cursorStyle || 'bar';
  term.options.cursorStyle = style;
  term.options.cursorInactiveStyle = style;

  // Cursor Blink
  term.options.cursorBlink = currentSettings.cursorBlink !== false;

  // Font Family
  const fontKey = currentSettings.fontFamily || 'SauceCodePro Nerd Font Mono';
  term.options.fontFamily = FONT_MAP[fontKey] || fontKey || DEFAULT_FONT_STACK;

  // Font Size (synchronized with terminal.js persistence)
  const fontSize = getSavedTerminalFontSize();
  if (term.options.fontSize !== fontSize) {
    term.options.fontSize = fontSize;
  }

  handleTerminalResize();
}

// Modal DOM elements
let modalOverlay = null;
let btnOpenSettings = null;
let btnCloseSettings = null;
let btnDoneSettings = null;

let chkSound = null;
let chkVibration = null;
let chkCursorBlink = null;
let rngFontSize = null;
let lblFontSize = null;
let btnFontDec = null;
let btnFontInc = null;
let selFontFamily = null;
let cursorStyleButtons = [];

let settingsOpenedAt = 0;

export function openSettingsModal() {
  if (!modalOverlay) return;
  settingsOpenedAt = Date.now();
  syncUiFromSettings();
  modalOverlay.classList.remove('hidden');
}

export function closeSettingsModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.add('hidden');
}

function syncUiFromSettings() {
  if (chkSound) chkSound.checked = Boolean(currentSettings.soundEnabled);
  if (chkVibration) chkVibration.checked = currentSettings.vibrationEnabled !== false;
  if (chkCursorBlink) chkCursorBlink.checked = currentSettings.cursorBlink !== false;

  const curFontSize = getSavedTerminalFontSize();
  if (rngFontSize) rngFontSize.value = String(curFontSize);
  if (lblFontSize) lblFontSize.textContent = `${curFontSize}px`;

  if (selFontFamily) {
    selFontFamily.value = currentSettings.fontFamily || 'SauceCodePro Nerd Font Mono';
  }

  cursorStyleButtons.forEach((btn) => {
    const style = btn.dataset.cursorStyle;
    const isActive = (currentSettings.cursorStyle || 'bar') === style;
    if (isActive) {
      btn.className = 'btn-cursor-style flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-[#51afef]/15 border border-[#51afef] text-xs font-bold text-[#51afef] shadow-sm transition cursor-pointer';
    } else {
      btn.className = 'btn-cursor-style flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-[#1b2229] border border-[#3f444a] text-xs text-[#bbc2cf] hover:text-[#DFDFDF] hover:border-[#51afef]/60 transition cursor-pointer';
    }
  });
}

export function initSettings() {
  loadSettings();

  modalOverlay = document.getElementById('settings-modal-overlay');
  btnOpenSettings = document.getElementById('btn-open-settings');
  btnCloseSettings = document.getElementById('btn-close-settings-modal');
  btnDoneSettings = document.getElementById('btn-done-settings-modal');

  chkSound = document.getElementById('setting-sound-enabled');
  chkVibration = document.getElementById('setting-vibration-enabled');
  chkCursorBlink = document.getElementById('setting-cursor-blink');
  rngFontSize = document.getElementById('setting-font-size');
  lblFontSize = document.getElementById('setting-font-size-val');
  btnFontDec = document.getElementById('btn-font-dec');
  btnFontInc = document.getElementById('btn-font-inc');
  selFontFamily = document.getElementById('setting-font-family');
  cursorStyleButtons = Array.from(document.querySelectorAll('.btn-cursor-style'));

  // Attach Open / Close events
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsModal();
    });
  }

  const drawerSettingsBtn = document.getElementById('btn-drawer-settings');
  if (drawerSettingsBtn) {
    drawerSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openSettingsModal();
    });
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', closeSettingsModal);
  }
  if (btnDoneSettings) {
    btnDoneSettings.addEventListener('click', closeSettingsModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay && Date.now() - settingsOpenedAt > 350) {
        closeSettingsModal();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay && !modalOverlay.classList.contains('hidden')) {
      closeSettingsModal();
    }
  });

  // Sound toggle listener
  if (chkSound) {
    chkSound.addEventListener('change', () => {
      updateSetting('soundEnabled', chkSound.checked);
    });
  }

  // Vibration toggle listener
  if (chkVibration) {
    chkVibration.addEventListener('change', () => {
      updateSetting('vibrationEnabled', chkVibration.checked);
      if (chkVibration.checked && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([20]);
      }
    });
  }

  // Cursor style buttons
  cursorStyleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.cursorStyle || 'bar';
      updateSetting('cursorStyle', style);
      syncUiFromSettings();
    });
  });

  // Cursor blink toggle
  if (chkCursorBlink) {
    chkCursorBlink.addEventListener('change', () => {
      updateSetting('cursorBlink', chkCursorBlink.checked);
    });
  }

  // Font size slider & stepper buttons
  const setFontSize = (newSize) => {
    const clamped = Math.min(32, Math.max(8, newSize));
    saveTerminalFontSize(clamped);
    if (lblFontSize) lblFontSize.textContent = `${clamped}px`;
    if (rngFontSize) rngFontSize.value = String(clamped);
    applySettingsToTerminal();
  };

  if (rngFontSize) {
    rngFontSize.addEventListener('input', () => {
      const val = parseInt(rngFontSize.value, 10);
      if (val) setFontSize(val);
    });
  }

  if (btnFontDec) {
    btnFontDec.addEventListener('click', () => {
      const cur = getSavedTerminalFontSize();
      setFontSize(cur - 1);
    });
  }

  if (btnFontInc) {
    btnFontInc.addEventListener('click', () => {
      const cur = getSavedTerminalFontSize();
      setFontSize(cur + 1);
    });
  }

  // Font family dropdown
  if (selFontFamily) {
    selFontFamily.addEventListener('change', () => {
      updateSetting('fontFamily', selFontFamily.value);
    });
  }

  // Initial apply on boot
  applySettingsToTerminal();
}
