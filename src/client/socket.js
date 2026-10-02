import { term, fitAddon, writeTerminal, handleTerminalResize } from './terminal.js';

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusBox = document.getElementById('connection-status-box');

let ws = null;
let currentSession = null;
let reconnectTimer = null;
const RECONNECT_DELAY_MS = 3000;

export function updateStatus(state, message) {
  statusDot.className = `dot ${state}`;
  statusText.textContent = message;
  if (statusBox) statusBox.title = message;
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

export function scheduleReconnect(sessionName) {
  if (reconnectTimer) return;
  const targetSession = sessionName || currentSession;
  if (!targetSession) return;

  updateStatus('disconnected', `Disconnected (${targetSession}) - reconnecting in 3s...`);

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
    updateStatus('connected', `Connected (${sessionName})`);
    term.focus();
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
        }
      } catch (e) {}
    }

    writeTerminal(event.data);
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    updateStatus('disconnected', `Disconnected (${sessionName})`);
    scheduleReconnect(sessionName);
  };

  socket.onerror = () => {
    if (ws !== socket) return;
    updateStatus('disconnected', `Connection error (${sessionName})`);
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
    term.focus();
  }
}
