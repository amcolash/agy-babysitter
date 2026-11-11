import { sendInput } from './socket.js';
import { getCurrentTerminalInput, pasteTextToTerminal } from './terminal.js';

const inputPopupOverlay = document.getElementById('input-popup-overlay');
const textarea = document.getElementById('terminal-input-textarea');
const btnSend = document.getElementById('btn-send-input-popup');
const btnCancel = document.getElementById('btn-cancel-input-popup');
const btnClose = document.getElementById('btn-close-input-popup');
const btnClear = document.getElementById('btn-input-clear-text');

let isOpen = false;
let openedAt = 0;
let isInputEnabled = false;

export function isInputModalEnabled() {
  return isInputEnabled;
}

export function setInputModalEnabled(enabled) {
  isInputEnabled = Boolean(enabled);
  if (!isInputEnabled) {
    closeInputModal();
  }
  if (textarea) {
    textarea.disabled = !isInputEnabled;
  }
  if (btnSend) {
    btnSend.disabled = !isInputEnabled;
  }
}

export function isInputModalOpen() {
  return isOpen;
}

export function openInputModal(initialText = '') {
  if (!inputPopupOverlay || !textarea) return;
  if (!isInputEnabled) return;
  isOpen = true;
  openedAt = Date.now();

  let textToSet = initialText;

  // Always automatically grab uncommitted text from terminal prompt or selection if not provided
  if (!textToSet) {
    const grabbed = getCurrentTerminalInput();
    if (grabbed) {
      textToSet = grabbed;
    }
  }

  textarea.value = textToSet || '';
  inputPopupOverlay.classList.remove('hidden');

  // Focus textarea for mobile software keyboard and place cursor at the end
  textarea.focus();
  setTimeout(() => {
    if (isOpen && textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, 50);
}

export function closeInputModal() {
  if (!inputPopupOverlay || !textarea) return;
  isOpen = false;
  textarea.blur();
  inputPopupOverlay.classList.add('hidden');
}

export function sendCurrentInput() {
  if (!isInputEnabled || !textarea) return;
  const rawText = textarea.value;

  // Always clear the current prompt line first (Ctrl+E then Ctrl+U: move to end and kill backward)
  // so any existing uncommitted text at the prompt is replaced cleanly by the editor's content
  const clearPrompt = '\x05\x15';

  // Strip trailing newlines (since Enter will be sent explicitly to execute)
  const text = rawText.replace(/[\r\n]+$/, '');

  if (text.length > 0) {
    if (text.includes('\n')) {
      // Multi-line text: clear prompt first, then paste safely with bracketed paste if supported
      sendInput(clearPrompt);
      pasteTextToTerminal(text, sendInput);
      // Send Enter outside bracketed paste so the shell executes the command
      setTimeout(() => sendInput('\r'), 30);
    } else {
      // Single-line text: clear prompt, write text, and execute Enter atomically
      sendInput(clearPrompt + text + '\r');
    }
  } else {
    // Empty text: clear prompt and execute Enter
    sendInput(clearPrompt + '\r');
  }

  textarea.value = '';
  closeInputModal();
}

export function initInputModal() {
  if (btnSend) {
    btnSend.addEventListener('click', (e) => {
      e.preventDefault();
      sendCurrentInput();
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', (e) => {
      e.preventDefault();
      closeInputModal();
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.preventDefault();
      closeInputModal();
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', (e) => {
      e.preventDefault();
      if (textarea) {
        textarea.value = '';
        textarea.focus();
      }
    });
  }

  if (textarea) {
    let shiftHeld = false;

    textarea.addEventListener('keydown', (e) => {
      shiftHeld = Boolean(e.shiftKey);
      const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13;

      // Enter without Shift -> Send immediately
      if (isEnter && !e.shiftKey) {
        e.preventDefault();
        sendCurrentInput();
        return;
      }

      // Escape -> Close
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        closeInputModal();
        return;
      }

      // Tab -> insert Tab
      if (e.key === 'Tab' || e.keyCode === 9) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      }
    });

    textarea.addEventListener('keyup', (e) => {
      shiftHeld = Boolean(e.shiftKey);
    });

    // Mobile virtual keyboards: handle soft Enter / Return key via beforeinput event
    textarea.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertLineBreak' && !shiftHeld) {
        e.preventDefault();
        sendCurrentInput();
      }
    });
  }

  // Dismiss on clicking overlay backdrop (ignore clicks within 350ms of opening to prevent ghost clicks on mobile)
  if (inputPopupOverlay) {
    inputPopupOverlay.addEventListener('click', (e) => {
      if (e.target === inputPopupOverlay && Date.now() - openedAt > 350) {
        closeInputModal();
      }
    });
  }
}
