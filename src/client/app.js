import { initTerminal } from './terminal.js';
import { sendInput, sendResize } from './socket.js';
import { initSessions, loadSessions } from './sessions.js';
import { initModal, initInfo } from './modal.js';
import { initInputModal } from './inputModal.js';
import { initActions } from './actions.js';
import { initNotifications } from './notifications.js';

import { registerSW } from 'virtual:pwa-register';

// Initialize all UI subsystems
initNotifications();
initTerminal(sendInput, sendResize);
initSessions();
initModal();
initInputModal();
initActions();

// Auto-updating PWA service worker
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

// Boot application data & initial zellij connection
(async function boot() {
  await initInfo();
  await loadSessions();
})();
