import { sendInput } from './socket.js';
import { term, getCurrentTerminalInput } from './terminal.js';
import { showToast } from './toast.js';

const inputPopupOverlay = document.getElementById('input-popup-overlay');
const textarea = document.getElementById('terminal-input-textarea');
const sendEnterCheckbox = document.getElementById('input-send-enter-checkbox');
const replaceLineCheckbox = document.getElementById('input-replace-line-checkbox');
const btnSend = document.getElementById('btn-send-input-popup');
const btnCancel = document.getElementById('btn-cancel-input-popup');
const btnClose = document.getElementById('btn-close-input-popup');
const btnClear = document.getElementById('btn-input-clear-text');
const btnHistoryPrev = document.getElementById('btn-input-history-prev');
const btnHistoryNext = document.getElementById('btn-input-history-next');
const btnGrabTerminal = document.getElementById('btn-input-grab-terminal');
const charCount = document.getElementById('input-char-count');

// Helper key chips
const btnChipGrab = document.getElementById('btn-chip-grab');
const btnChipEsc = document.getElementById('btn-chip-esc');
const btnChipCtrlC = document.getElementById('btn-chip-ctrl-c');
const btnChipTab = document.getElementById('btn-chip-tab');
const btnChipUp = document.getElementById('btn-chip-up');
const btnChipDown = document.getElementById('btn-chip-down');

const STORAGE_KEY_HISTORY = 'agy_input_history';
const MAX_HISTORY_ITEMS = 50;

let inputHistory = [];
let historyIndex = -1;
let isOpen = false;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inputHistory = parsed;
      }
    }
  } catch (e) {
    inputHistory = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(inputHistory.slice(-MAX_HISTORY_ITEMS)));
  } catch (e) {}
}

function addToHistory(text) {
  if (!text || !text.trim()) return;
  const trimmed = text.trim();
  // Remove existing duplicate if at the very end
  if (inputHistory[inputHistory.length - 1] === trimmed) return;
  inputHistory.push(trimmed);
  if (inputHistory.length > MAX_HISTORY_ITEMS) {
    inputHistory = inputHistory.slice(-MAX_HISTORY_ITEMS);
  }
  saveHistory();
}

function updateCharCount() {
  if (!charCount || !textarea) return;
  const count = textarea.value.length;
  charCount.textContent = `${count} char${count === 1 ? '' : 's'}`;
}

function updateHistoryButtons() {
  if (!btnHistoryPrev || !btnHistoryNext) return;
  btnHistoryPrev.disabled = inputHistory.length === 0 || historyIndex <= 0;
  btnHistoryNext.disabled = historyIndex >= inputHistory.length;
}

export function isInputModalOpen() {
  return isOpen;
}

export function openInputModal(initialText = '') {
  if (!inputPopupOverlay || !textarea) return;
  isOpen = true;
  loadHistory();
  historyIndex = inputHistory.length;

  if (initialText) {
    textarea.value = initialText;
  }
  updateCharCount();
  updateHistoryButtons();

  inputPopupOverlay.classList.remove('hidden');

  // Focus textarea for mobile software keyboard
  textarea.focus();
  setTimeout(() => {
    if (isOpen && textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, 50);
}

export function grabFromTerminal() {
  const text = getCurrentTerminalInput();
  if (text) {
    textarea.value = text;
    updateCharCount();
    if (replaceLineCheckbox) {
      replaceLineCheckbox.checked = true;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    showToast('Grabbed command from terminal', 'info');
  } else {
    showToast('No active command found in terminal', 'warning');
  }
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
    addToHistory(text);
    sendInput(text + (sendEnter ? '\r' : ''));
  } else if (sendEnter) {
    // Empty text with Enter enabled -> send Enter keypress
    sendInput('\r');
  }

  if (replaceLineCheckbox) {
    replaceLineCheckbox.checked = false;
  }

  textarea.value = '';
  updateCharCount();
  closeInputModal();
}

export function initInputModal() {
  loadHistory();

  if (btnGrabTerminal) {
    btnGrabTerminal.addEventListener('click', (e) => {
      e.preventDefault();
      grabFromTerminal();
    });
  }

  if (btnChipGrab) {
    btnChipGrab.addEventListener('click', (e) => {
      e.preventDefault();
      grabFromTerminal();
    });
  }

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
        updateCharCount();
        textarea.focus();
      }
    });
  }

  if (btnHistoryPrev) {
    btnHistoryPrev.addEventListener('click', (e) => {
      e.preventDefault();
      if (inputHistory.length === 0) return;
      if (historyIndex > 0) {
        historyIndex--;
        textarea.value = inputHistory[historyIndex] || '';
        updateCharCount();
        updateHistoryButtons();
        textarea.focus();
      }
    });
  }

  if (btnHistoryNext) {
    btnHistoryNext.addEventListener('click', (e) => {
      e.preventDefault();
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++;
        textarea.value = inputHistory[historyIndex] || '';
      } else {
        historyIndex = inputHistory.length;
        textarea.value = '';
      }
      updateCharCount();
      updateHistoryButtons();
      textarea.focus();
    });
  }

  if (textarea) {
    textarea.addEventListener('input', () => {
      updateCharCount();
    });

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

      // Up arrow when at beginning or empty -> History prev
      if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        if (inputHistory.length > 0 && historyIndex > 0) {
          e.preventDefault();
          historyIndex--;
          textarea.value = inputHistory[historyIndex] || '';
          updateCharCount();
          updateHistoryButtons();
        }
      }

      // Down arrow when at end -> History next
      if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length) {
        if (historyIndex < inputHistory.length) {
          e.preventDefault();
          historyIndex++;
          textarea.value = inputHistory[historyIndex] || '';
          updateCharCount();
          updateHistoryButtons();
        }
      }
    });
  }

  // Helper key chips
  if (btnChipEsc) {
    btnChipEsc.addEventListener('click', (e) => {
      e.preventDefault();
      sendInput('\x1b');
      closeInputModal();
    });
  }

  if (btnChipCtrlC) {
    btnChipCtrlC.addEventListener('click', (e) => {
      e.preventDefault();
      sendInput('\x03');
      closeInputModal();
    });
  }

  if (btnChipTab) {
    btnChipTab.addEventListener('click', (e) => {
      e.preventDefault();
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        updateCharCount();
        textarea.focus();
      }
    });
  }

  if (btnChipUp) {
    btnChipUp.addEventListener('click', (e) => {
      e.preventDefault();
      sendInput('\x1b[A');
      closeInputModal();
    });
  }

  if (btnChipDown) {
    btnChipDown.addEventListener('click', (e) => {
      e.preventDefault();
      sendInput('\x1b[B');
      closeInputModal();
    });
  }

  // Dismiss on clicking overlay backdrop
  if (inputPopupOverlay) {
    inputPopupOverlay.addEventListener('click', (e) => {
      if (e.target === inputPopupOverlay) {
        closeInputModal();
      }
    });
  }
}
