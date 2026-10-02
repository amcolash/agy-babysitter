import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

const terminalContainer = document.getElementById('terminal-container');
const terminalEl = document.getElementById('terminal');

export const term = new Terminal({
  cursorBlink: true,
  cursorStyle: 'block',
  fontSize: 14,
  fontFamily: '"SauceCodePro Nerd Font Mono", "SauceCodePro Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  theme: {
    foreground: '#bbc2cf',
    background: '#1b2229',
    cursor: '#51afef',
    cursorAccent: '#282c34',
    selectionForeground: '#DFDFDF',
    selectionBackground: '#3f444a',
    // 16 ANSI Colors matching Doom One
    black: '#1b2229',
    brightBlack: '#3f444a',
    red: '#ff6c6b',
    brightRed: '#ff6655',
    green: '#98be65',
    brightGreen: '#99bb66',
    yellow: '#ECBE7B',
    brightYellow: '#ECBE7B',
    blue: '#51afef',
    brightBlue: '#51afef',
    magenta: '#c678dd',
    brightMagenta: '#c678dd',
    cyan: '#46D9FF',
    brightCyan: '#46D9FF',
    white: '#DFDFDF',
    brightWhite: '#bbc2cf'
  },
  allowProposedApi: true,
  scrollback: 50000
});

export const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

export const webLinksAddon = new WebLinksAddon();
term.loadAddon(webLinksAddon);

let onResizeCallback = null;

export function initTerminal(onInput, onResize) {
  onResizeCallback = onResize;
  term.open(terminalEl);
  fitAddon.fit();

  term.onData((data) => {
    if (onInput) onInput(data);
  });

  // Mobile Touch Swipe Scrolling Support
  let lastTouchY = 0;
  let accumulatedTouchDelta = 0;
  const SWIPE_STEP_PX = 16;

  terminalContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      lastTouchY = e.touches[0].clientY;
      accumulatedTouchDelta = 0;
    }
  }, { passive: true });

  terminalContainer.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const currentY = e.touches[0].clientY;
      const diffY = currentY - lastTouchY;
      lastTouchY = currentY;
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
  }, { passive: true });

  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(handleTerminalResize);
  });
  resizeObserver.observe(terminalContainer);
  window.addEventListener('resize', handleTerminalResize);

  // Handle mobile virtual keyboard resize smoothly
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      handleTerminalResize();
      setTimeout(() => term.scrollToBottom(), 50);
    });
  }

  // Automatic copy to clipboard when selecting text
  term.onSelectionChange(() => {
    const selectedText = term.getSelection();
    if (selectedText && selectedText.length > 0 && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(selectedText).catch(() => {});
    }
  });

  // Standard paste support (Ctrl+V / Cmd+V or right-click paste)
  window.addEventListener('paste', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const pastedText = e.clipboardData?.getData('text');
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
  term.focus();
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
