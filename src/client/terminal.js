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

  // Mobile Touch Swipe Scrolling Support for Tmux
  let lastTouchY = 0;
  let accumulatedTouchDelta = 0;
  const SWIPE_STEP_PX = 18;

  terminalContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      lastTouchY = e.touches[0].clientY;
      accumulatedTouchDelta = 0;
    }
  }, { passive: true });

  terminalContainer.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const diffY = currentY - lastTouchY;
      lastTouchY = currentY;
      accumulatedTouchDelta += diffY;

      while (Math.abs(accumulatedTouchDelta) >= SWIPE_STEP_PX) {
        const col = Math.max(1, Math.min(term.cols || 80, Math.floor(currentX / 9) || 1));
        const row = Math.max(1, Math.min(term.rows || 24, Math.floor(currentY / 18) || 1));

        if (accumulatedTouchDelta > 0) {
          // Swiping down -> scroll up in tmux history (SGR Wheel Up)
          accumulatedTouchDelta -= SWIPE_STEP_PX;
          if (onInput) onInput(`\x1b[<64;${col};${row}M`);
        } else {
          // Swiping up -> scroll down towards bottom (SGR Wheel Down)
          accumulatedTouchDelta += SWIPE_STEP_PX;
          if (onInput) onInput(`\x1b[<65;${col};${row}M`);
        }
      }
    }
  }, { passive: true });

  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(handleTerminalResize);
  });
  resizeObserver.observe(terminalContainer);
  window.addEventListener('resize', handleTerminalResize);
}

export function handleTerminalResize() {
  try {
    fitAddon.fit();
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
