import { sendAction, sendInput } from './socket.js';
import { openInputModal } from './inputModal.js';

const fabContainer = document.getElementById('fab-container');
const btnFab = document.getElementById('btn-fab');
const fabMenu = document.getElementById('fab-menu');
const btnFabInput = document.getElementById('btn-fab-input');
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

  // Close FAB menu on outside click
  document.addEventListener('click', (e) => {
    if (isFabOpen && fabContainer && !fabContainer.contains(e.target)) {
      toggleFabMenu(false);
    }
  });

  // FAB speed-dial buttons (Input, Esc, Up, Down, Enter)
  if (btnFabInput) {
    btnFabInput.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFabMenu(false);
      openInputModal();
    });
  }

  if (btnFabEsc) {
    btnFabEsc.addEventListener('click', (e) => {
      e.stopPropagation();
      sendInput('\x1b');
    });
  }

  if (btnFabUp) {
    btnFabUp.addEventListener('click', (e) => {
      e.stopPropagation();
      sendInput('\x1b[A');
    });
  }

  if (btnFabDown) {
    btnFabDown.addEventListener('click', (e) => {
      e.stopPropagation();
      sendInput('\x1b[B');
    });
  }

  if (btnFabEnter) {
    btnFabEnter.addEventListener('click', (e) => {
      e.stopPropagation();
      sendAction('enter');
    });
  }
}
