import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openInputModal } from "./inputModal.js";
import { showToast } from "./toast.js";
import { onTerminalResized, markTurnStarted } from "./notifications.js";
import { switchRelativeSession, switchToNextNotifiedSession, moveActiveSession, terminateSession, closeDrawer } from "./sessions.js";
import { getCurrentSession } from "./socket.js";
import { openModal, closeModal } from "./modal.js";
import { closeInputModal } from "./inputModal.js";
import { closeSettingsModal } from "./settings.js";

const terminalContainer = document.getElementById("terminal-container");
const terminalEl = document.getElementById("terminal");

export function isMobileDevice() {
  return (
    typeof window !== "undefined" &&
    (("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
      (window.innerWidth <= 1024 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)))
  );
}

export function getSavedTerminalFontSize() {
  const isMobile = isMobileDevice();
  const key = isMobile ? "agy_terminal_mobile_font_size" : "agy_terminal_desktop_font_size";
  const saved = parseInt(localStorage.getItem(key) || localStorage.getItem("agy_terminal_font_size"), 10);
  const defaultSize = isMobile ? 13 : 14;
  return saved >= 8 && saved <= 36 ? saved : defaultSize;
}

export function saveTerminalFontSize(size) {
  const isMobile = isMobileDevice();
  const key = isMobile ? "agy_terminal_mobile_font_size" : "agy_terminal_desktop_font_size";
  localStorage.setItem(key, String(size));
  localStorage.setItem("agy_terminal_font_size", String(size));
}

const initialFontSize = getSavedTerminalFontSize();

let lastSelection = '';

export const term = new Terminal({
  cursorBlink: true,
  cursorStyle: "bar",
  cursorWidth: 2,
  cursorInactiveStyle: "bar",
  fontSize: initialFontSize,
  fontFamily:
    '"SauceCodePro Nerd Font Mono", "SauceCodePro Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  theme: {
    foreground: "#bbc2cf",
    background: "#1b2229",
    cursor: "#51afef",
    cursorAccent: "#282c34",
    selectionForeground: "#DFDFDF",
    selectionBackground: "#3f444a",
    // 16 ANSI Colors matching Doom One
    black: "#282c34",
    brightBlack: "#5b6268",
    red: "#ff6c6b",
    brightRed: "#ff6655",
    green: "#98be65",
    brightGreen: "#99bb66",
    yellow: "#ECBE7B",
    brightYellow: "#ECBE7B",
    blue: "#51afef",
    brightBlue: "#51afef",
    magenta: "#c678dd",
    brightMagenta: "#c678dd",
    cyan: "#46D9FF",
    brightCyan: "#46D9FF",
    white: "#DFDFDF",
    brightWhite: "#ffffff",
  },
  allowProposedApi: true,
  scrollback: 50000,
});

export const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

export const webLinksAddon = new WebLinksAddon();
term.loadAddon(webLinksAddon);

// Register parser handlers to ensure cursorBlink is never disabled by terminal escape sequences (such as DEC private mode 12 or DECSCUSR steady cursors)
term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
  const has12 = params.some((p) => p === 12 || (Array.isArray(p) && p[0] === 12));
  if (has12) {
    queueMicrotask(() => {
      term.options.cursorBlink = true;
      if (term._core?.coreService?.decPrivateModes) {
        term._core.coreService.decPrivateModes.cursorBlink = true;
      }
    });
    if (params.length === 1) return true;
  }
  return false;
});

term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
  let val = params[0] || 1;
  // If steady cursor is requested (2, 4, 6), convert to blinking equivalent (1, 3, 5)
  if (val === 2) val = 1;
  else if (val === 4) val = 3;
  else if (val === 6) val = 5;
  else if (val === 0) val = 5;

  let style = 'bar';
  if (val === 1) style = 'block';
  else if (val === 3) style = 'underline';
  else if (val === 5) style = 'bar';

  if (term._core?.coreService?.decPrivateModes) {
    term._core.coreService.decPrivateModes.cursorStyle = style;
    term._core.coreService.decPrivateModes.cursorBlink = true;
  }
  return true;
});

let onResizeCallback = null;

export function configureHelperTextarea() {
  const helperTextarea = terminalEl.querySelector('.xterm-helper-textarea');
  if (helperTextarea) {
    if (isMobileDevice()) {
      helperTextarea.setAttribute('inputmode', 'none');
      helperTextarea.setAttribute('tabindex', '-1');
      helperTextarea.setAttribute('readonly', 'true');
    } else {
      helperTextarea.removeAttribute('readonly');
      helperTextarea.setAttribute('autocorrect', 'off');
      helperTextarea.setAttribute('autocapitalize', 'none');
      helperTextarea.setAttribute('autocomplete', 'off');
      helperTextarea.setAttribute('spellcheck', 'false');
      helperTextarea.setAttribute('inputmode', 'search');
      helperTextarea.setAttribute('enterkeyhint', 'enter');
    }
    helperTextarea.setAttribute('data-gramm', 'false');
    helperTextarea.setAttribute('data-enable-grammarly', 'false');
  }
}

let isTerminalInputEnabled = false;

export function isTerminalInputAllowed() {
  return isTerminalInputEnabled;
}

export function setTerminalInputEnabled(enabled) {
  isTerminalInputEnabled = Boolean(enabled);
  try {
    term.options.disableStdin = !isTerminalInputEnabled;
  } catch (e) {}

  const helperTextarea = terminalEl ? terminalEl.querySelector('.xterm-helper-textarea') : null;
  if (helperTextarea) {
    if (!isTerminalInputEnabled) {
      helperTextarea.setAttribute('readonly', 'true');
      helperTextarea.setAttribute('disabled', 'true');
      helperTextarea.blur();
    } else {
      if (!isMobileDevice()) {
        helperTextarea.removeAttribute('readonly');
        helperTextarea.removeAttribute('disabled');
      }
    }
  }
}

export function initTerminal(onInput, onResize) {
  onResizeCallback = onResize;
  term.open(terminalEl);
  fitAddon.fit();
  configureHelperTextarea();
  setTerminalInputEnabled(false);

  term.onData((data) => {
    if (!isTerminalInputEnabled) return;
    if (onInput) onInput(data);
  });

  // Intercept left-click mouse selection to simulate shiftKey=true for xterm.
  // This allows native xterm text highlighting/selection while preserving terminal mouse reporting for wheel scrolling!
  let isLeftDragging = false;

  terminalContainer.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 0) {
        isLeftDragging = true;
        try {
          Object.defineProperty(e, 'shiftKey', { get: () => true, configurable: true });
        } catch (err) {}
      }
    },
    { capture: true }
  );

  terminalContainer.addEventListener(
    'mousemove',
    (e) => {
      if (isLeftDragging || e.buttons === 1) {
        try {
          Object.defineProperty(e, 'shiftKey', { get: () => true, configurable: true });
        } catch (err) {}
      } else if (e.buttons === 0) {
        // When simply hovering without buttons pressed, stop hover propagation to xterm's mouse tracking
        // so background repaints don't clear the user's active selection!
        e.stopPropagation();
      }
    },
    { capture: true }
  );

  terminalContainer.addEventListener(
    'mouseup',
    (e) => {
      if (e.button === 0 || isLeftDragging) {
        isLeftDragging = false;
        try {
          Object.defineProperty(e, 'shiftKey', { get: () => true, configurable: true });
        } catch (err) {}
        updateSelectionFromAllSources();
      }
    },
    { capture: true }
  );

  // Re-apply whenever terminal container receives focus/click/touch
  terminalContainer.addEventListener("focusin", configureHelperTextarea);
  terminalContainer.addEventListener("touchstart", configureHelperTextarea, { passive: true });

  // Mobile Touch Swipe Scrolling & Pinch-to-Zoom Support
  let startTouchX = 0;
  let startTouchY = 0;
  let lastTouchY = 0;
  let lastTouchX = 0;
  let hasMovedTouch = false;
  let accumulatedTouchDelta = 0;
  const SWIPE_STEP_PX = 14;

  let initialPinchDistance = null;
  let initialPinchFontSize = initialFontSize;

  function getPinchDistance(touches) {
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  terminalContainer.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        startTouchX = e.touches[0].clientX;
        startTouchY = e.touches[0].clientY;
        lastTouchY = startTouchY;
        lastTouchX = startTouchX;
        hasMovedTouch = false;
        accumulatedTouchDelta = 0;
        initialPinchDistance = null;
      } else if (e.touches.length === 2) {
        hasMovedTouch = true;
        initialPinchDistance = getPinchDistance(e.touches);
        initialPinchFontSize = term.options.fontSize || 14;
      }
    },
    { passive: false },
  );

  terminalContainer.addEventListener(
    "touchmove",
    (e) => {
      // Two-finger Pinch to Zoom / Font Resize on mobile
      if (e.touches.length === 2 && initialPinchDistance && isMobileDevice()) {
        e.preventDefault();
        const currentDistance = getPinchDistance(e.touches);
        if (currentDistance && initialPinchDistance > 0) {
          const ratio = currentDistance / initialPinchDistance;
          const newFontSize = Math.min(32, Math.max(8, Math.round(initialPinchFontSize * ratio)));
          if (newFontSize !== term.options.fontSize) {
            term.options.fontSize = newFontSize;
            saveTerminalFontSize(newFontSize);
            handleTerminalResize();
          }
        }
        return;
      }

      // Single finger swipe scrolling
      if (e.touches.length === 1) {
        if (Math.hypot(e.touches[0].clientX - startTouchX, e.touches[0].clientY - startTouchY) > 8) {
          hasMovedTouch = true;
        }

        e.preventDefault();
        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const diffY = currentY - lastTouchY;
        lastTouchY = currentY;
        lastTouchX = currentX;
        accumulatedTouchDelta += diffY;

        const rect = terminalEl.getBoundingClientRect();
        const cellWidth = (rect.width / (term.cols || 80)) || 9;
        const cellHeight = (rect.height / (term.rows || 24)) || 18;
        const col = Math.max(1, Math.min(term.cols || 80, Math.floor((currentX - rect.left) / cellWidth) + 1));
        const row = Math.max(1, Math.min(term.rows || 24, Math.floor((currentY - rect.top) / cellHeight) + 1));

        while (Math.abs(accumulatedTouchDelta) >= SWIPE_STEP_PX) {
          if (accumulatedTouchDelta > 0) {
            // Swiping down -> scroll up in terminal buffer (SGR Wheel Up)
            accumulatedTouchDelta -= SWIPE_STEP_PX;
            if (onInput) onInput(`\x1b[<64;${col};${row}M`);
            term.scrollLines(-1);
          } else {
            // Swiping up -> scroll down towards bottom (SGR Wheel Down)
            accumulatedTouchDelta += SWIPE_STEP_PX;
            if (onInput) onInput(`\x1b[<65;${col};${row}M`);
            term.scrollLines(1);
          }
        }
      }
    },
    { passive: false },
  );

  terminalContainer.addEventListener(
    "touchend",
    (e) => {
      if (e.touches.length === 0) {
        if (!hasMovedTouch && isMobileDevice()) {
          // If tap occurred on a button or UI control inside terminalContainer, do not open input modal
          if (e.target && e.target.closest('button, select, input, textarea, a, #btn-open-drawer, #empty-session-state, #server-disconnected-state, #input-popup-overlay, #modal-overlay')) {
            initialPinchDistance = null;
            return;
          }
          if (!isTerminalInputEnabled) {
            initialPinchDistance = null;
            return;
          }
          if (e.cancelable) {
            e.preventDefault();
          }
          openInputModal();
        }
        initialPinchDistance = null;
      }
    },
    { passive: false },
  );

  const appContainer = document.getElementById("app-container");

  function updateAppViewportHeight() {
    if (window.visualViewport && appContainer) {
      const vh = window.visualViewport.height;
      appContainer.style.height = `${vh}px`;
      window.scrollTo(0, 0);
    }
    handleTerminalResize();
    setTimeout(() => term.scrollToBottom(), 50);
  }

  // Handle mobile virtual keyboard resize smoothly
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateAppViewportHeight);
    window.visualViewport.addEventListener("scroll", () => {
      window.scrollTo(0, 0);
    });
  }

  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(handleTerminalResize);
  });
  resizeObserver.observe(terminalContainer);
  window.addEventListener("resize", updateAppViewportHeight);

  // Re-fit when device orientation changes
  window.addEventListener("orientationchange", () => {
    setTimeout(updateAppViewportHeight, 100);
    setTimeout(updateAppViewportHeight, 300);
  });

  // Re-measure and re-fit when web fonts finish downloading
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      setTimeout(() => {
        handleTerminalResize();
        if (term.rows) {
          term.refresh(0, term.rows - 1);
        }
      }, 30);
    });
  }

  // Ensure terminal receives focus on desktop, or opens input popup on mobile
  terminalContainer.addEventListener("click", (e) => {
    if (e.target && e.target.closest('button, select, input, textarea, a, #btn-open-drawer, #empty-session-state, #server-disconnected-state, #input-popup-overlay, #modal-overlay')) {
      return;
    }
    if (isMobileDevice()) {
      // Handled cleanly via touchend
    } else {
      term.focus();
    }
  });

  // Multi-source selection tracking
  function updateSelectionFromAllSources() {
    const termSel = term.hasSelection() ? term.getSelection() : '';
    const winSel = window.getSelection() ? window.getSelection().toString() : '';
    const text = termSel || winSel;
    if (text && text.length > 0) {
      lastSelection = text;
    }
  }

  term.onSelectionChange(updateSelectionFromAllSources);
  document.addEventListener('selectionchange', updateSelectionFromAllSources);
  window.addEventListener('mouseup', updateSelectionFromAllSources);

  let lastCloseTabTime = 0;
  function handleCloseTabAction() {
    const now = Date.now();
    if (now - lastCloseTabTime < 250) return;
    lastCloseTabTime = now;

    // 1. Close New Session modal if open
    const sessionModal = document.getElementById('modal-overlay');
    if (sessionModal && !sessionModal.classList.contains('hidden')) {
      closeModal();
      return;
    }

    // 2. Close Settings modal if open
    const settingsModal = document.getElementById('settings-modal-overlay');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
      closeSettingsModal();
      return;
    }

    // 3. Close Input popup modal if open
    const inputModal = document.getElementById('input-popup-overlay');
    if (inputModal && !inputModal.classList.contains('hidden')) {
      closeInputModal();
      return;
    }

    // 4. Close mobile sessions drawer if open
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    if (drawerBackdrop && drawerBackdrop.classList.contains('open')) {
      closeDrawer();
      return;
    }

    // 5. Otherwise terminate currently active session
    const current = getCurrentSession();
    if (current) {
      terminateSession(current);
    }
  }

  let lastNewTabTime = 0;
  function handleNewTabAction() {
    const now = Date.now();
    if (now - lastNewTabTime < 250) return;
    lastNewTabTime = now;

    // Close any other open modals/drawers first
    const settingsModal = document.getElementById('settings-modal-overlay');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
      closeSettingsModal();
    }
    const inputModal = document.getElementById('input-popup-overlay');
    if (inputModal && !inputModal.classList.contains('hidden')) {
      closeInputModal();
    }
    closeDrawer();

    openModal();
  }

  let lastNotifSwitchTime = 0;
  function handleNextNotifiedSessionAction(direction = 1) {
    const now = Date.now();
    if (now - lastNotifSwitchTime < 150) return;
    lastNotifSwitchTime = now;
    const switched = switchToNextNotifiedSession(direction);
    if (switched) {
      closeDrawer();
    }
  }

  // Global window keydown interceptor in capture phase
  window.addEventListener(
    'keydown',
    (e) => {
      const isCtrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
      const isW = e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.keyCode === 87;
      const isT = e.key === 't' || e.key === 'T' || e.code === 'KeyT' || e.keyCode === 84;
      const isN = e.key === 'n' || e.key === 'N' || e.code === 'KeyN' || e.keyCode === 78;

      const isCloseTab = isCtrlOrMeta && isW;
      const isNewTab = isCtrlOrMeta && (isT || isN);

      if (isCloseTab) {
        e.preventDefault();
        e.stopPropagation();
        handleCloseTabAction();
        return;
      }

      if (isNewTab) {
        e.preventDefault();
        e.stopPropagation();
        handleNewTabAction();
        return;
      }

      const activeTag = document.activeElement?.tagName;
      const isInsideOtherInput =
        (activeTag === 'INPUT' || activeTag === 'TEXTAREA') &&
        !document.activeElement.classList.contains('xterm-helper-textarea');
      if (isInsideOtherInput) return;

      // Tab switching: Ctrl+Shift+[ / ArrowLeft (prev) and Ctrl+Shift+] / ArrowRight (next)
      const isPrevTab =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === '[' || e.key === '{' || e.code === 'BracketLeft' || e.key === 'ArrowLeft' || e.key === 'Left' || e.code === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Up' || e.code === 'ArrowUp');
      const isNextTab =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === ']' || e.key === '}' || e.code === 'BracketRight' || e.key === 'ArrowRight' || e.key === 'Right' || e.code === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Down' || e.code === 'ArrowDown');

      if (isPrevTab) {
        e.preventDefault();
        e.stopPropagation();
        switchRelativeSession(-1);
        return;
      }

      if (isNextTab) {
        e.preventDefault();
        e.stopPropagation();
        switchRelativeSession(1);
        return;
      }

      // Notification tab cycling: Ctrl+Tab (forward) and Ctrl+Shift+Tab (backward)
      const isTab = e.key === 'Tab' || e.key === 'Backtab' || e.code === 'Tab' || e.keyCode === 9;
      const isNotifTab = isCtrlOrMeta && isTab;

      if (isNotifTab) {
        e.preventDefault();
        e.stopPropagation();
        handleNextNotifiedSessionAction(e.shiftKey ? -1 : 1);
        return;
      }

      // Tab moving (reordering): Ctrl+Shift+PageUp or Alt+Shift+Left/PageUp (move left)
      // and Ctrl+Shift+PageDown or Alt+Shift+Right/PageDown (move right)
      const isMoveLeft =
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'PageUp' || e.code === 'PageUp')) ||
        (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'Left' || e.code === 'ArrowLeft' || e.key === 'PageUp' || e.code === 'PageUp'));
      const isMoveRight =
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'PageDown' || e.code === 'PageDown')) ||
        (e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'Right' || e.code === 'ArrowRight' || e.key === 'PageDown' || e.code === 'PageDown'));

      if (isMoveLeft) {
        e.preventDefault();
        e.stopPropagation();
        moveActiveSession(-1);
        return;
      }

      if (isMoveRight) {
        e.preventDefault();
        e.stopPropagation();
        moveActiveSession(1);
        return;
      }

      const isC = e.key === 'C' || e.key === 'c' || e.code === 'KeyC' || e.keyCode === 67;
      const isV = e.key === 'V' || e.key === 'v' || e.code === 'KeyV' || e.keyCode === 86;

      if (e.ctrlKey && e.shiftKey && isC) {
        e.preventDefault();
        e.stopPropagation();
        copySelectionToClipboard(true);
        return;
      }

      if (e.ctrlKey && e.shiftKey && isV) {
        e.preventDefault();
        e.stopPropagation();
        pasteClipboardToTerminal(onInput);
        return;
      }

      // Shift+Enter: send modifyOtherKeys Shift+Enter (\x1b[27;2;13~) so CLI inserts a newline instead of submitting
      const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13;
      if (isEnter && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (onInput) {
          onInput('\x1b[27;2;13~');
        }
        return;
      }
    },
    { capture: true }
  );

  // Custom Key Event Handler for xterm (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+C, Ctrl+Shift+V, Cmd+C, Cmd+V, Ctrl+C with selection, Ctrl+Shift+[/], Ctrl+Shift+Arrow, Shift+Enter)
  term.attachCustomKeyEventHandler((e) => {
    const isCtrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
    const isW = e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.keyCode === 87;
    const isT = e.key === 't' || e.key === 'T' || e.code === 'KeyT' || e.keyCode === 84;
    const isN = e.key === 'n' || e.key === 'N' || e.code === 'KeyN' || e.keyCode === 78;

    const isCloseTab = isCtrlOrMeta && isW;
    const isNewTab = isCtrlOrMeta && (isT || isN);

    if (isCloseTab) {
      if (e.type === 'keydown') {
        handleCloseTabAction();
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (isNewTab) {
      if (e.type === 'keydown') {
        handleNewTabAction();
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13;
    if (isEnter && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing) {
      if (e.type === 'keydown') {
        if (onInput) {
          onInput('\x1b[27;2;13~');
        }
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    const isPrevTab =
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      (e.key === '[' || e.key === '{' || e.code === 'BracketLeft' || e.key === 'ArrowLeft' || e.key === 'Left' || e.code === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Up' || e.code === 'ArrowUp');
    const isNextTab =
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      (e.key === ']' || e.key === '}' || e.code === 'BracketRight' || e.key === 'ArrowRight' || e.key === 'Right' || e.code === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Down' || e.code === 'ArrowDown');

    if (isPrevTab) {
      if (e.type === 'keydown') {
        switchRelativeSession(-1);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (isNextTab) {
      if (e.type === 'keydown') {
        switchRelativeSession(1);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Notification tab cycling: Ctrl+Tab (forward) and Ctrl+Shift+Tab (backward)
    const isTab = e.key === 'Tab' || e.key === 'Backtab' || e.code === 'Tab' || e.keyCode === 9;
    const isNotifTab = isCtrlOrMeta && isTab;

    if (isNotifTab) {
      if (e.type === 'keydown') {
        handleNextNotifiedSessionAction(e.shiftKey ? -1 : 1);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    const isMoveLeft =
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'PageUp' || e.code === 'PageUp')) ||
      (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'Left' || e.code === 'ArrowLeft' || e.key === 'PageUp' || e.code === 'PageUp'));
    const isMoveRight =
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'PageDown' || e.code === 'PageDown')) ||
      (e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'Right' || e.code === 'ArrowRight' || e.key === 'PageDown' || e.code === 'PageDown'));

    if (isMoveLeft) {
      if (e.type === 'keydown') {
        moveActiveSession(-1);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (isMoveRight) {
      if (e.type === 'keydown') {
        moveActiveSession(1);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    const isC = e.key === 'C' || e.key === 'c' || e.code === 'KeyC' || e.keyCode === 67;
    const isV = e.key === 'V' || e.key === 'v' || e.code === 'KeyV' || e.keyCode === 86;

    const hasActiveSelection = Boolean(getActiveSelectionText());
    const isCtrlShiftC = e.ctrlKey && e.shiftKey && isC;
    const isCmdC = e.metaKey && isC && hasActiveSelection;
    const isCtrlCWithSel = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && isC && hasActiveSelection;

    if (isCtrlShiftC || isCmdC || isCtrlCWithSel) {
      if (e.type === 'keydown') {
        copySelectionToClipboard(true);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    const isCtrlShiftV = e.ctrlKey && e.shiftKey && isV;
    const isCmdV = e.metaKey && isV;

    if (isCtrlShiftV || isCmdV) {
      if (e.type === 'keydown') {
        pasteClipboardToTerminal(onInput);
      }
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    return true;
  });

  // Prevent browser default on keyup for hijacked combinations (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+Shift+Tab)
  window.addEventListener(
    'keyup',
    (e) => {
      const isCtrlOrMeta = (e.ctrlKey || e.metaKey) && !e.altKey;
      const isW = e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.keyCode === 87;
      const isT = e.key === 't' || e.key === 'T' || e.code === 'KeyT' || e.keyCode === 84;
      const isN = e.key === 'n' || e.key === 'N' || e.code === 'KeyN' || e.keyCode === 78;
      const isTab = e.key === 'Tab' || e.key === 'Backtab' || e.code === 'Tab' || e.keyCode === 9;
      if (isCtrlOrMeta && (isW || isT || isN || isTab)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true }
  );

  // When in fullscreen mode, lock keys so browser never handles Ctrl+W / Ctrl+N / Ctrl+T / Tab
  if (typeof navigator !== 'undefined' && navigator.keyboard && typeof navigator.keyboard.lock === 'function') {
    const tryLockKeys = () => {
      if (document.fullscreenElement) {
        navigator.keyboard.lock(['KeyW', 'KeyN', 'KeyT', 'Tab']).catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', tryLockKeys);
  }

  // Right-click custom context menu
  const contextMenu = document.getElementById('terminal-context-menu');
  const btnMenuCopy = document.getElementById('menu-item-copy');
  const btnMenuPaste = document.getElementById('menu-item-paste');
  const btnMenuSelectAll = document.getElementById('menu-item-select-all');
  const btnMenuClear = document.getElementById('menu-item-clear');

  function closeContextMenu() {
    if (contextMenu) contextMenu.classList.add('hidden');
  }

  terminalContainer.addEventListener('contextmenu', (e) => {
    if (isMobileDevice()) return;
    e.preventDefault();
    if (!contextMenu) return;

    updateSelectionFromAllSources();

    // Position menu near cursor within viewport
    const menuWidth = 190;
    const menuHeight = 160;
    const x = Math.min(window.innerWidth - menuWidth - 10, Math.max(10, e.clientX));
    const y = Math.min(window.innerHeight - menuHeight - 10, Math.max(10, e.clientY));

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  if (btnMenuCopy) {
    btnMenuCopy.addEventListener('click', () => {
      copySelectionToClipboard(true);
      closeContextMenu();
      term.focus();
    });
  }

  if (btnMenuPaste) {
    btnMenuPaste.addEventListener('click', () => {
      pasteClipboardToTerminal(onInput);
      closeContextMenu();
      term.focus();
    });
  }

  if (btnMenuSelectAll) {
    btnMenuSelectAll.addEventListener('click', () => {
      term.selectAll();
      lastSelection = term.getSelection();
      closeContextMenu();
      term.focus();
    });
  }

  if (btnMenuClear) {
    btnMenuClear.addEventListener('click', () => {
      term.clear();
      closeContextMenu();
      term.focus();
    });
  }

  // Standard paste support (Ctrl+V / Cmd+V or right-click paste)
  window.addEventListener("paste", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const pastedText = e.clipboardData?.getData("text");
    if (pastedText && onInput) {
      e.preventDefault();
      onInput(pastedText);
    }
  });
}

export function getActiveSelectionText() {
  try {
    const termSel = term.hasSelection() ? term.getSelection() : '';
    if (termSel && termSel.length > 0) return termSel;
  } catch (e) {}

  try {
    const winSel = window.getSelection() ? window.getSelection().toString() : '';
    if (winSel && winSel.length > 0) return winSel;
  } catch (e) {}

  if (lastSelection && lastSelection.length > 0) {
    return lastSelection;
  }

  return '';
}

export async function copyTextToClipboard(text, showFeedback = true) {
  if (!text) {
    if (showFeedback) showToast('No text selected to copy', 'info', 1200);
    return false;
  }

  let success = false;

  // 1. Synchronous execCommand copy (reliable across user gestures and HTTP contexts)
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0.01';
    ta.style.zIndex = '-9999';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    success = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {
    success = false;
  }

  // 2. Modern Async Clipboard API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch (err) {}
  }

  if (success) {
    if (showFeedback) showToast('Copied to clipboard', 'info', 1200);
    return true;
  } else {
    if (showFeedback) showToast('Failed to copy to clipboard', 'error', 1500);
    return false;
  }
}

export async function copySelectionToClipboard(showFeedback = true) {
  const selection = getActiveSelectionText();
  if (selection) {
    return copyTextToClipboard(selection, showFeedback);
  }

  const promptText = getCurrentTerminalInput();
  if (promptText) {
    return copyTextToClipboard(promptText, showFeedback);
  }

  if (showFeedback) {
    showToast('No text selected to copy', 'info', 1200);
  }
  return false;
}

export async function pasteClipboardToTerminal(onInputCallback) {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text && onInputCallback) {
        onInputCallback(text);
        return true;
      }
    }
  } catch (err) {
    // If clipboard read permission is blocked, open input modal
    openInputModal();
  }
  return false;
}

export function handleTerminalResize() {
  onTerminalResized();
  try {
    // Invalidate cached char measurements on xterm's internal charSizeService if present
    if (term._core?._charSizeService?.measure) {
      term._core._charSizeService.measure();
    }
    fitAddon.fit();
    term.scrollToBottom();
    if (onResizeCallback && term.cols && term.rows) {
      onResizeCallback(term.cols, term.rows);
    }
  } catch (e) {
    // Ignore fit errors if container not rendered yet
  }
}

export function writeTerminal(data) {
  if (typeof data === 'string' && data.includes('\x1b[?12l')) {
    data = data.replaceAll('\x1b[?12l', '');
  }
  term.write(data);
}

export function clearTerminal() {
  term.clear();
  if (!isMobileDevice()) term.focus();
}

export function getRecentTerminalLines(numLines = 25) {
  try {
    const buffer = term.buffer.active;
    const lines = [];
    const currentY = buffer.baseY + buffer.cursorY;
    const startY = Math.max(0, currentY - numLines);

    for (let y = startY; y <= currentY; y++) {
      const line = buffer.getLine(y);
      if (line) {
        const text = line.translateToString(true).trim();
        if (text) {
          lines.push(text);
        }
      }
    }
    return lines;
  } catch (e) {
    return [];
  }
}

/**
 * Checks if a string is a known CLI prompt placeholder, divider line, or tip
 * @param {string} text
 * @returns {boolean}
 */
export function isPlaceholderOrTip(text) {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;

  // Exact symbol / divider / whitespace only
  if (/^([>›❯●▶»?$\#:]|>{1,3}|\.\.\.|[─━\-_=]+)$/.test(t)) {
    return true;
  }

  // agy mode tips: "Accept-edits mode: ...", "Plan mode: ...", "Bypass mode: ...", "Auto mode: ...", "Default mode: ..."
  if (/^(accept-edits|plan|bypass|auto|default)\s+mode\b/i.test(t)) {
    return true;
  }

  // Common UI tips, keybinding hints, and help text in prompt placeholders
  if (/\(shift\+tab/i.test(t)) {
    return true;
  }
  if (/file edits (auto-approved|require approval)/i.test(t)) {
    return true;
  }
  if (/^(type (a|your) (prompt|message)|ask anything|press enter to|enter a command|shift\+enter for)/i.test(t)) {
    return true;
  }
  if (/^(\/ to search skills|\? for help|\/ for commands|esc to dismiss|\(tab to (auto-)?complete\))/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * Strip shell or agy prompt prefixes from raw terminal line.
 * If the line does not contain an actual prompt prefix, returns '' (never returns random output).
 * @param {string} rawLine
 * @returns {string}
 */
export function stripPromptPrefix(rawLine) {
  if (!rawLine) return '';
  const text = rawLine.trim();

  if (isPlaceholderOrTip(text)) {
    return '';
  }

  // Standard shell prompts like "user@host:~/path$ command" or "user@host:~# command"
  const shellPromptRegex = /^.*?[@:][^$#%❯›>]*?[\$#%❯›>]\s*(.*)$/;
  const shellMatch = text.match(shellPromptRegex);
  if (shellMatch && typeof shellMatch[1] === 'string') {
    const stripped = shellMatch[1].trim();
    return isPlaceholderOrTip(stripped) ? '' : stripped;
  }

  // Symbol prompts like "> input", "› input", "❯ input", "● input", "$ input", "# input"
  const symbolPromptRegex = /^([>›❯●▶»?$\#]|>{1,3}|\.\.\.)\s+(.*)$/;
  const symbolMatch = text.match(symbolPromptRegex);
  if (symbolMatch && typeof symbolMatch[2] === 'string') {
    const stripped = symbolMatch[2].trim();
    return isPlaceholderOrTip(stripped) ? '' : stripped;
  }

  // Named prompts like "agy> input", "input> input", "search: input"
  const namedPromptRegex = /^[a-zA-Z0-9_\-\.]+([>:\?])\s+(.*)$/;
  const namedMatch = text.match(namedPromptRegex);
  if (namedMatch && typeof namedMatch[2] === 'string') {
    const stripped = namedMatch[2].trim();
    return isPlaceholderOrTip(stripped) ? '' : stripped;
  }

  // Line has no prompt prefix -> not an input prompt line
  return '';
}

/**
 * Extract the current uncommitted command or prompt from the terminal buffer
 * @returns {string}
 */
export function getCurrentTerminalInput() {
  try {
    // 1. Check if user currently has highlighted/selected text in terminal
    const selection = term.getSelection()?.trim();
    if (selection) {
      if (!isPlaceholderOrTip(selection)) {
        const strippedSelection = stripPromptPrefix(selection);
        return strippedSelection || selection;
      }
      return '';
    }

    const buffer = term.buffer.active;
    const currentAbsoluteY = buffer.baseY + buffer.cursorY;
    const totalLines = buffer.length;

    // Helper: is a line a horizontal divider box line (e.g. ────────────────)
    const isDividerLine = (line) => {
      if (!line) return false;
      const str = line.translateToString(true).trim();
      return /^[─━\-_=]{5,}/.test(str);
    };

    // 2. Pattern A: Check for agy prompt enclosed between top and bottom divider lines (───)
    let bottomDividerY = -1;
    let topDividerY = -1;

    // Scan backwards from the end of the buffer to find the active prompt box
    const searchStartY = Math.min(totalLines - 1, currentAbsoluteY + 6);
    const searchEndY = Math.max(0, currentAbsoluteY - 14);

    for (let y = searchStartY; y >= searchEndY; y--) {
      const line = buffer.getLine(y);
      if (isDividerLine(line)) {
        if (bottomDividerY === -1) {
          bottomDividerY = y;
        } else {
          topDividerY = y;
          break;
        }
      }
    }

    // If an agy divider box is detected
    if (topDividerY !== -1 && bottomDividerY !== -1 && bottomDividerY > topDividerY && (bottomDividerY - topDividerY) <= 10) {
      const promptLines = [];
      for (let y = topDividerY + 1; y < bottomDividerY; y++) {
        const line = buffer.getLine(y);
        if (!line) continue;
        const raw = line.translateToString(true).trim();
        if (!raw) continue;
        // Strip leading prompt indicator > or › or ❯
        const stripped = raw.replace(/^[>›❯●▶»]\s*/, '');
        if (stripped) {
          promptLines.push(stripped);
        }
      }

      const combined = promptLines.join('\n').trim();
      if (combined && !isPlaceholderOrTip(combined)) {
        return combined;
      }
      // agy box was found on screen, so user is in agy: if box is empty or tip, return ''
      return '';
    }

    // 3. Pattern B: Standard shell prompt at cursor
    let startY = currentAbsoluteY;
    while (startY > 0) {
      const line = buffer.getLine(startY);
      if (!line || !line.isWrapped) break;
      startY--;
    }

    let endY = currentAbsoluteY;
    while (endY < totalLines - 1) {
      const nextLine = buffer.getLine(endY + 1);
      if (!nextLine || !nextLine.isWrapped) break;
      endY++;
    }

    let fullText = '';
    for (let y = startY; y <= endY; y++) {
      const line = buffer.getLine(y);
      if (line) {
        fullText += line.translateToString(y === endY);
      }
    }

    const stripped = stripPromptPrefix(fullText);
    if (stripped && !isPlaceholderOrTip(stripped)) {
      return stripped;
    }

    return '';
  } catch (e) {
    console.warn('Failed to extract terminal input:', e);
    return '';
  }
}

/**
 * Extract lines strictly above the active prompt box or cursor line
 * @param {number} numLines
 * @returns {string[]}
 */
export function getLinesAbovePrompt(numLines = 15) {
  try {
    const buffer = term.buffer.active;
    const currentAbsoluteY = buffer.baseY + buffer.cursorY;
    const totalLines = buffer.length;

    const isDividerLine = (line) => {
      if (!line) return false;
      const str = line.translateToString(true).trim();
      return /^[─━\-_=]{5,}/.test(str);
    };

    let topDividerY = -1;
    let bottomDividerY = -1;
    const searchStartY = Math.min(totalLines - 1, currentAbsoluteY + 6);
    const searchEndY = Math.max(0, currentAbsoluteY - 14);

    for (let y = searchStartY; y >= searchEndY; y--) {
      const line = buffer.getLine(y);
      if (isDividerLine(line)) {
        if (bottomDividerY === -1) {
          bottomDividerY = y;
        } else {
          topDividerY = y;
          break;
        }
      }
    }

    let cutoffY = currentAbsoluteY;
    if (topDividerY !== -1) {
      cutoffY = topDividerY;
    }

    const lines = [];
    const startY = Math.max(0, cutoffY - numLines);
    for (let y = startY; y < cutoffY; y++) {
      const line = buffer.getLine(y);
      if (line) {
        const text = line.translateToString(true).trim();
        if (text && !isDividerLine(line)) {
          lines.push(text);
        }
      }
    }
    return lines;
  } catch (e) {
    return [];
  }
}
