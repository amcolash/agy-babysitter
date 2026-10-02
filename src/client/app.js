import { initTerminal } from './terminal.js';
import { sendInput, sendResize } from './socket.js';
import { initSessions, loadSessions } from './sessions.js';
import { initModal, initInfo } from './modal.js';
import { initActions } from './actions.js';

// Initialize all UI subsystems
initTerminal(sendInput, sendResize);
initSessions();
initModal();
initActions();

// Register service worker for PWA installability
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Boot application data & initial tmux connection
(async function boot() {
  await initInfo();
  await loadSessions();
})();
