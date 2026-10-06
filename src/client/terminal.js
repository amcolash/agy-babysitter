import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openInputModal } from "./inputModal.js";

const terminalContainer = document.getElementById("terminal-container");
const terminalEl = document.getElementById("terminal");

const savedFontSize = parseInt(localStorage.getItem("agy_terminal_font_size"), 10);
const initialFontSize = savedFontSize >= 8 && savedFontSize <= 36 ? savedFontSize : 14;

export function isMobileDevice() {
  return (
    typeof window !== "undefined" &&
    (("ontouchstart" in window || navigator.maxTouchPoints > 0) &&
      (window.innerWidth <= 1024 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)))
  );
}

export const term = new Terminal({
  cursorBlink: true,
  cursorStyle: "block",
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
    black: "#1b2229",
    brightBlack: "#3f444a",
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
    brightWhite: "#bbc2cf",
  },
  allowProposedApi: true,
  scrollback: 50000,
});

export const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

export const webLinksAddon = new WebLinksAddon();
term.loadAddon(webLinksAddon);

let onResizeCallback = null;

export function configureHelperTextarea() {
  const helperTextarea = terminalEl.querySelector('.xterm-helper-textarea');
  if (helperTextarea) {
    if (isMobileDevice()) {
      helperTextarea.setAttribute('inputmode', 'none');
      helperTextarea.setAttribute('tabindex', '-1');
    } else {
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

export function initTerminal(onInput, onResize) {
  onResizeCallback = onResize;
  term.open(terminalEl);
  fitAddon.fit();
  configureHelperTextarea();

  term.onData((data) => {
    if (onInput) onInput(data);
  });

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
      if (e.touches.length === 2 && initialPinchDistance) {
        e.preventDefault();
        const currentDistance = getPinchDistance(e.touches);
        if (currentDistance && initialPinchDistance > 0) {
          const ratio = currentDistance / initialPinchDistance;
          const newFontSize = Math.min(32, Math.max(8, Math.round(initialPinchFontSize * ratio)));
          if (newFontSize !== term.options.fontSize) {
            term.options.fontSize = newFontSize;
            localStorage.setItem("agy_terminal_font_size", String(newFontSize));
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

        while (Math.abs(accumulatedTouchDelta) >= SWIPE_STEP_PX) {
          const col = Math.max(1, Math.min(term.cols || 80, Math.floor(currentX / 9) || 1));
          const row = Math.max(1, Math.min(term.rows || 24, Math.floor(currentY / 18) || 1));

          if (accumulatedTouchDelta > 0) {
            // Swiping down -> scroll up in terminal buffer / zellij history (SGR Wheel Up)
            accumulatedTouchDelta -= SWIPE_STEP_PX;
            if (onInput) onInput(`\x1b[<64;${col};${row}M`);
            term.scrollLines(-2);
          } else {
            // Swiping up -> scroll down towards bottom (SGR Wheel Down)
            accumulatedTouchDelta += SWIPE_STEP_PX;
            if (onInput) onInput(`\x1b[<65;${col};${row}M`);
            term.scrollLines(2);
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
          // Clean tap on terminal screen on mobile -> open popup
          openInputModal();
        }
        initialPinchDistance = null;
      }
    },
    { passive: true },
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

  // Re-fit when fonts finish downloading
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      setTimeout(handleTerminalResize, 50);
    });
  }

  // Ensure terminal receives focus on desktop, or opens input popup on mobile
  terminalContainer.addEventListener("click", () => {
    if (isMobileDevice()) {
      openInputModal();
    } else {
      term.focus();
    }
  });

  // Automatic copy to clipboard when selecting text
  term.onSelectionChange(() => {
    const selectedText = term.getSelection();
    if (selectedText && selectedText.length > 0 && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(selectedText).catch(() => {});
    }
  });

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

export function handleTerminalResize() {
  try {
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
