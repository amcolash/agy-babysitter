import { term, fitAddon, writeTerminal, handleTerminalResize, isMobileDevice } from './terminal.js';

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusBox = document.getElementById('connection-status-box');
const btnStatusReload = document.getElementById('btn-status-reload');

// Full-screen Disconnected / Updating State Overlay
const disconnectedOverlay = document.getElementById('server-disconnected-state');
const disconnectTitle = document.getElementById('disconnect-title');
const disconnectSubtitle = document.getElementById('disconnect-subtitle');
const disconnectIconBox = document.getElementById('disconnect-icon-box');
const disconnectIconSpin = document.getElementById('disconnect-icon-spin');
const btnRetryConnection = document.getElementById('btn-retry-connection');
const btnReloadPage = document.getElementById('btn-reload-page');

let ws = null;
let currentSession = null;
let reconnectTimer = null;
let isServerUpdating = false;
let isPollingForOnline = false;
const RECONNECT_DELAY_MS = 2500;

if (btnStatusReload) {
  btnStatusReload.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.reload();
  });
}

if (btnReloadPage) {
  btnReloadPage.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.reload();
  });
}

if (btnRetryConnection) {
  btnRetryConnection.addEventListener('click', (e) => {
    e.preventDefault();
    clearReconnectTimer();
    if (currentSession) {
      connectTerminal(currentSession);
    }
  });
}

export function isSocketConnected() {
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

export function isServerUpdatingState() {
  return isServerUpdating;
}

export function showDisconnectedOverlay(title, subtitle, mode = 'disconnected') {
  if (!disconnectedOverlay) return;

  if (disconnectTitle && title) disconnectTitle.textContent = title;
  if (disconnectSubtitle && subtitle) disconnectSubtitle.textContent = subtitle;

  if (disconnectIconBox) {
    if (mode === 'updating') {
      disconnectIconBox.className =
        'w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#21242b] border border-[#51afef]/50 flex items-center justify-center mb-4 text-[#51afef] shadow-xl shadow-[#51afef]/10 transition-all duration-300';
    } else {
      disconnectIconBox.className =
        'w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-[#21242b] border border-[#3f444a] flex items-center justify-center mb-4 text-[#ECBE7B] shadow-xl shadow-black/50 transition-all duration-300';
    }
  }

  disconnectedOverlay.classList.remove('hidden');
}

export function hideDisconnectedOverlay() {
  if (disconnectedOverlay) {
    disconnectedOverlay.classList.add('hidden');
  }
}

export function updateStatus(state, message) {
  if (statusDot) statusDot.className = `dot ${state}`;
  if (statusText) statusText.textContent = message;
  if (statusBox) statusBox.title = message;

  if (btnStatusReload) {
    if (state === 'connected') {
      btnStatusReload.classList.add('hidden');
    } else {
      btnStatusReload.classList.remove('hidden');
    }
  }
}

export function getCurrentSession() {
  return currentSession;
}

export function setCurrentSession(name) {
  currentSession = name;
}

export function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export function disconnectTerminal() {
  clearReconnectTimer();
  if (ws) {
    const oldWs = ws;
    ws = null;
    oldWs.onclose = null;
    oldWs.onerror = null;
    try {
      oldWs.close();
    } catch (e) {}
  }
  currentSession = null;
  updateStatus('disconnected', 'Disconnected');
  hideDisconnectedOverlay();
}

function startPollingServerOnline() {
  if (isPollingForOnline) return;
  isPollingForOnline = true;

  const checkOnline = async () => {
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' });
      if (res.ok) {
        console.log('[Recovery] Server is back online, reloading page...');
        window.location.reload();
        return;
      }
    } catch (e) {}
    setTimeout(checkOnline, 700);
  };

  setTimeout(checkOnline, 500);
}

export function scheduleReconnect(sessionName) {
  if (reconnectTimer) return;
  const targetSession = sessionName || currentSession;
  if (!targetSession) return;

  if (isServerUpdating) {
    updateStatus('connecting', 'Server updating - reconnecting...');
    showDisconnectedOverlay('Server Updating...', 'The server is applying updates and restarting. Reconnecting automatically...', 'updating');
    startPollingServerOnline();
    return;
  }

  updateStatus('disconnected', `Disconnected (${targetSession}) - reconnecting in 2s...`);
  showDisconnectedOverlay('Connecting to Server...', 'Looks like you are disconnected from the server. Attempting to reconnect...', 'disconnected');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentSession) {
      connectTerminal(currentSession);
    }
  }, RECONNECT_DELAY_MS);
}

export function connectTerminal(sessionName) {
  clearReconnectTimer();

  if (ws) {
    const oldWs = ws;
    ws = null;
    oldWs.onclose = null;
    oldWs.onerror = null;
    try {
      oldWs.close();
    } catch (e) {}
  }

  currentSession = sessionName;
  updateStatus('connecting', `Connecting (${sessionName})...`);

  fitAddon.fit();
  const cols = term.cols || 80;
  const rows = term.rows || 24;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws?session=${encodeURIComponent(sessionName)}&cols=${cols}&rows=${rows}`;

  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    clearReconnectTimer();

    if (isServerUpdating) {
      console.log('[Upgrade] Connected during server upgrade, refreshing page with latest bundle...');
      window.location.reload();
      return;
    }

    hideDisconnectedOverlay();
    updateStatus('connected', `Connected (${sessionName})`);
    if (!isMobileDevice()) term.focus();
    setTimeout(handleTerminalResize, 100);
  };

  socket.onmessage = (event) => {
    if (ws !== socket) return;

    if (typeof event.data === 'string' && event.data.startsWith('{')) {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'reload') {
          console.log('[Auto-Refresh] UI change detected, reloading page...');
          window.location.reload();
          return;
        } else if (payload.type === 'restarting') {
          console.log('[Server Notice] Server is updating, entering upgrade state...');
          isServerUpdating = true;
          showDisconnectedOverlay('Server Updating...', 'The server is applying updates and restarting. Reconnecting automatically...', 'updating');
          startPollingServerOnline();
          return;
        }
      } catch (e) {}
    }

    writeTerminal(event.data);
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    scheduleReconnect(sessionName);
  };

  socket.onerror = () => {
    if (ws !== socket) return;
    scheduleReconnect(sessionName);
  };
}

export function sendInput(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data }));
  }
}

export function sendResize(cols, rows) {
  if (ws && ws.readyState === WebSocket.OPEN && cols && rows) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

export function sendAction(action) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'action', action }));
  }
}
