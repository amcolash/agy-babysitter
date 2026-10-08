import { term, fitAddon, writeTerminal, handleTerminalResize, isMobileDevice } from './terminal.js';
import { onTerminalDataReceived, clearSessionNotification, handleUserInteraction, markTurnStarted, onSessionConnected, onTerminalResized, handleServerSessionNotification, handleServerSessionNotificationsSync } from './notifications.js';
import { handleServerSessionsChanged, loadSessions } from './sessions.js';
import { handleServerQuota } from './quota.js';

// Full-screen Disconnected / Updating State Overlay
const disconnectedOverlay = document.getElementById('server-disconnected-state');
const disconnectTitle = document.getElementById('disconnect-title');
const disconnectSubtitle = document.getElementById('disconnect-subtitle');
const btnRetryConnection = document.getElementById('btn-retry-connection');
const btnReloadPage = document.getElementById('btn-reload-page');

let ws = null;
let currentSession = null;
let reconnectTimer = null;
let isServerUpdating = false;
let isPollingForOnline = false;
const RECONNECT_DELAY_MS = 2500;

// Attach click listeners to all reload buttons
document.querySelectorAll('.btn-status-reload, #btn-status-reload').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.reload();
  });
});

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

let overlayTimer = null;
const DISCONNECT_OVERLAY_DELAY_MS = 5000; // 5-second grace period before showing full-screen overlay

export function isServerUpdatingState() {
  return isServerUpdating;
}

export function showDisconnectedOverlay(title, subtitle) {
  if (!disconnectedOverlay) return;

  if (disconnectTitle && title) disconnectTitle.textContent = title;
  if (disconnectSubtitle && subtitle) disconnectSubtitle.textContent = subtitle;

  disconnectedOverlay.classList.remove('hidden');
}

export function scheduleDisconnectedOverlay(title, subtitle, delayMs = DISCONNECT_OVERLAY_DELAY_MS) {
  if (overlayTimer) return;
  overlayTimer = setTimeout(() => {
    overlayTimer = null;
    showDisconnectedOverlay(title, subtitle);
  }, delayMs);
}

export function clearDisconnectedOverlayTimer() {
  if (overlayTimer) {
    clearTimeout(overlayTimer);
    overlayTimer = null;
  }
}

export function hideDisconnectedOverlay() {
  clearDisconnectedOverlayTimer();
  if (disconnectedOverlay) {
    disconnectedOverlay.classList.add('hidden');
  }
}

export function updateStatus(state, message) {
  const dots = document.querySelectorAll('.status-dot');
  dots.forEach((dot) => {
    dot.className = `dot ${state} status-dot`;
  });

  const texts = document.querySelectorAll('.status-text');
  texts.forEach((text) => {
    text.textContent = message;
  });

  const boxes = document.querySelectorAll('.connection-status-box');
  boxes.forEach((box) => {
    box.title = message;
  });
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
  clearDisconnectedOverlayTimer();
  currentSession = null;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ type: 'detach' }));
    } catch (e) {}
  }
  updateStatus('disconnected', 'No active sessions');
  hideDisconnectedOverlay();
}

export function startPollingServerOnline() {
  if (isPollingForOnline) return;
  isPollingForOnline = true;

  const checkOnline = async () => {
    try {
      const res = await fetch('/api/sessions', { cache: 'no-store' });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        console.log('[Recovery] Server is back online, reloading page...');
        window.location.reload();
        return;
      }
    } catch (e) {}
    setTimeout(checkOnline, 700);
  };

  setTimeout(checkOnline, 500);
}

// Window online / offline listeners
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    updateStatus('disconnected', 'Network offline');
    scheduleDisconnectedOverlay('Network Offline', 'Your device appears to be offline. Reconnecting once connection is restored...', 5000);
  });

  window.addEventListener('online', () => {
    updateStatus('connecting', 'Network restored - connecting...');
    connectTerminal(currentSession);
  });

  // Reconnect if connection was dropped while tab was in background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!isSocketConnected()) {
        connectTerminal(currentSession);
      }
    }
  });
}

export function scheduleReconnect(sessionName) {
  if (reconnectTimer) return;
  const targetSession = sessionName || currentSession;

  if (isServerUpdating) {
    updateStatus('connecting', 'Reconnecting...');
    scheduleDisconnectedOverlay('Server Updating...', 'The server is applying updates and restarting. Reconnecting automatically...', 5000);
    startPollingServerOnline();
    return;
  }

  updateStatus('connecting', targetSession ? `Reconnecting (${targetSession})...` : 'Reconnecting...');
  // Delay full screen overlay for 5 seconds so brief server restarts happen completely seamlessly without flashing
  scheduleDisconnectedOverlay('Connecting to Server...', 'Looks like you are disconnected from the server. Attempting to reconnect...', 5000);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectTerminal(currentSession);
  }, 1200);
}

export function connectTerminal(sessionName) {
  clearReconnectTimer();

  currentSession = sessionName || null;
  if (sessionName) {
    onSessionConnected(sessionName);
    updateStatus('connecting', `Connecting (${sessionName})...`);
  } else {
    updateStatus('disconnected', 'No active sessions');
  }

  try {
    fitAddon.fit();
  } catch (e) {}
  const cols = term.cols || 80;
  const rows = term.rows || 24;

  // If existing WebSocket connection is already open, reuse it dynamically!
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (sessionName) {
      ws.send(JSON.stringify({ type: 'attach', session: sessionName, cols, rows }));
      updateStatus('connected', `Connected (${sessionName})`);
      if (!isMobileDevice()) term.focus();
      setTimeout(handleTerminalResize, 100);
    } else {
      ws.send(JSON.stringify({ type: 'detach' }));
    }
    return;
  }

  if (ws) {
    const oldWs = ws;
    ws = null;
    oldWs.onclose = null;
    oldWs.onerror = null;
    try {
      oldWs.close();
    } catch (e) {}
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = sessionName ? `?session=${encodeURIComponent(sessionName)}&cols=${cols}&rows=${rows}` : '';
  const wsUrl = `${protocol}//${location.host}/ws${query}`;

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
    if (currentSession) {
      updateStatus('connected', `Connected (${currentSession})`);
      if (!isMobileDevice()) term.focus();
      setTimeout(handleTerminalResize, 100);
    } else {
      updateStatus('disconnected', 'No active sessions');
    }
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
          showDisconnectedOverlay('Server Updating...', 'The server is applying updates and restarting. Reconnecting automatically...');
          startPollingServerOnline();
          return;
        } else if (payload.type === 'session_attached') {
          hideDisconnectedOverlay();
          updateStatus('connected', `Connected (${payload.session})`);
          if (!isMobileDevice()) term.focus();
          setTimeout(handleTerminalResize, 100);
          return;
        } else if (payload.type === 'session_detached') {
          // Handled gracefully via sessions_changed broadcast
          return;
        } else if (payload.type === 'session_attach_error') {
          console.warn(`[Socket] Attach error: ${payload.error}`);
          loadSessions();
          return;
        } else if (payload.type === 'session_resized') {
          onTerminalResized();
          return;
        } else if (payload.type === 'sessions_changed' || payload.type === 'sessions_sync') {
          handleServerSessionsChanged(payload.sessions);
          return;
        } else if (payload.type === 'session_notification') {
          handleServerSessionNotification(payload.session, payload.state);
          return;
        } else if (payload.type === 'session_notifications_sync') {
          handleServerSessionNotificationsSync(payload.states);
          return;
        } else if (payload.type === 'quota_changed' || payload.type === 'quota_sync') {
          handleServerQuota(payload.quota);
          return;
        }
      } catch (e) {}
    }

    writeTerminal(event.data);
    onTerminalDataReceived(event.data);
  };

  socket.onclose = (event) => {
    if (ws !== socket) return;
    scheduleReconnect(currentSession);
  };

  socket.onerror = () => {
    if (ws !== socket) return;
    scheduleReconnect(currentSession);
  };
}

export function sendClearNotification(sessionName) {
  if (ws && ws.readyState === WebSocket.OPEN && sessionName) {
    ws.send(JSON.stringify({ type: 'clear_notification', session: sessionName }));
  }
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
  handleUserInteraction();
  markTurnStarted();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'action', action }));
  }
}
