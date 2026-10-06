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

      // Single finger swipe scrolling (scroll viewport only, never send raw escape sequences into stdin)
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
          if (accumulatedTouchDelta > 0) {
            // Swiping down -> scroll up in terminal buffer
            accumulatedTouchDelta -= SWIPE_STEP_PX;
            term.scrollLines(-2);
          } else {
            // Swiping up -> scroll down towards bottom
            accumulatedTouchDelta += SWIPE_STEP_PX;
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
          // If tap occurred on a button or UI control inside terminalContainer, do not open input modal
          if (e.target && e.target.closest('button, select, input, textarea, a, #btn-open-drawer, #empty-session-state, #server-disconnected-state')) {
            initialPinchDistance = null;
            return;
          }
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
  terminalContainer.addEventListener("click", (e) => {
    if (e.target && e.target.closest('button, select, input, textarea, a, #btn-open-drawer, #empty-session-state, #server-disconnected-state')) {
      return;
    }
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
