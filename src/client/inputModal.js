import { sendInput } from './socket.js';
import { getCurrentTerminalInput } from './terminal.js';

const inputPopupOverlay = document.getElementById('input-popup-overlay');
const textarea = document.getElementById('terminal-input-textarea');
const sendEnterCheckbox = document.getElementById('input-send-enter-checkbox');
const replaceLineCheckbox = document.getElementById('input-replace-line-checkbox');
const btnSend = document.getElementById('btn-send-input-popup');
const btnCancel = document.getElementById('btn-cancel-input-popup');
const btnClose = document.getElementById('btn-close-input-popup');
const btnClear = document.getElementById('btn-input-clear-text');

let isOpen = false;
let openedAt = 0;

export function isInputModalOpen() {
  return isOpen;
}

export function openInputModal(initialText = '') {
  if (!inputPopupOverlay || !textarea) return;
  isOpen = true;
  openedAt = Date.now();

  let textToSet = initialText;
  let hasGrabbedFromTerminal = false;

  // Always automatically grab uncommitted text from terminal prompt or selection if not provided
  if (!textToSet) {
    const grabbed = getCurrentTerminalInput();
    if (grabbed) {
      textToSet = grabbed;
      hasGrabbedFromTerminal = true;
    }
  }

  textarea.value = textToSet || '';
  if (replaceLineCheckbox) {
    replaceLineCheckbox.checked = hasGrabbedFromTerminal;
  }

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
  if (!textarea) return;
  const text = textarea.value;
  const sendEnter = sendEnterCheckbox ? sendEnterCheckbox.checked : true;
  const replaceLine = replaceLineCheckbox ? replaceLineCheckbox.checked : false;

  if (replaceLine) {
    // Send Ctrl+U (\x15) to clear the existing uncommitted prompt line on terminal
    sendInput('\x15');
  }

  if (text.length > 0) {
    sendInput(text + (sendEnter ? '\r' : ''));
  } else if (sendEnter) {
    // Empty text with Enter enabled -> send Enter keypress
    sendInput('\r');
  }

  if (replaceLineCheckbox) {
    replaceLineCheckbox.checked = false;
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
        if (replaceLineCheckbox) {
          replaceLineCheckbox.checked = false;
        }
        textarea.focus();
      }
    });
  }

  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      // Enter without Shift -> Send
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendCurrentInput();
        return;
      }

      // Escape -> Close
      if (e.key === 'Escape') {
        e.preventDefault();
        closeInputModal();
        return;
      }

      // Tab -> insert Tab
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 1;
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
