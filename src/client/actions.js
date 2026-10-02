import { sendAction, sendInput } from './socket.js';
import { term } from './terminal.js';

const btnFab = document.getElementById('btn-fab');
const fabMenu = document.getElementById('fab-menu');
const btnFabEsc = document.getElementById('btn-fab-esc');
const btnFabUp = document.getElementById('btn-fab-up');
const btnFabDown = document.getElementById('btn-fab-down');
const btnFabEnter = document.getElementById('btn-fab-enter');

let isFabOpen = false;

export function toggleFabMenu(forceState = null) {
  isFabOpen = forceState !== null ? forceState : !isFabOpen;
  if (!fabMenu || !btnFab) return;

  if (isFabOpen) {
    fabMenu.classList.remove('hidden');
    btnFab.classList.add('ring-2', 'ring-[#51afef]', 'ring-offset-2', 'ring-offset-[#282c34]');
    // Blur virtual keyboard if open
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    term.blur();
  } else {
    fabMenu.classList.add('hidden');
    btnFab.classList.remove('ring-2', 'ring-[#51afef]', 'ring-offset-2', 'ring-offset-[#282c34]');
  }
}

export function initActions() {
  // FAB Toggle
  if (btnFab) {
    btnFab.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFabMenu();
    });
  }

  // FAB 4 speed-dial buttons (Esc, Up, Down, Enter)
  if (btnFabEsc) {
    btnFabEsc.addEventListener('click', (e) => {
      e.stopPropagation();
      sendInput('\x1b');
      term.focus();
    });
  }

  if (btnFabUp) {
    btnFabUp.addEventListener('click', (e) => {
      e.stopPropagation();
      sendInput('\x1b[A');
      term.focus();
    });
  }

  if (btnFabDown) {
    btnFabDown.addEventListener('click', (e) => {
      e.stopPropagation();
      sendInput('\x1b[B');
      term.focus();
    });
  }

  if (btnFabEnter) {
    btnFabEnter.addEventListener('click', (e) => {
      e.stopPropagation();
      sendAction('enter');
    });
  }
}
