import { WebSocket } from 'ws';
import { touchWakelock } from './wakelock.js';
import { listSessions } from './tmuxManager.js';

// Stores notification state per session: Map<sessionName, 'settled' | 'input' | null>
const sessionStates = new Map();
let wssInstance = null;
let monitorInterval = null;
let lastSessionsHash = '';

function getSessionsSignature(sessions) {
  return sessions.map((s) => `${s.name}:${s.cwd}`).sort().join('|');
}

/**
 * Broadcasts the current list of active tmux sessions to all connected WebSocket clients
 * @param {Array} [sessions]
 */
export function broadcastSessionsList(sessions = null) {
  if (!wssInstance) return;
  const currentSessions = sessions || listSessions();
  const signature = getSessionsSignature(currentSessions);
  lastSessionsHash = signature;

  // Prune notification states for sessions that no longer exist
  const activeNames = new Set(currentSessions.map((s) => s.name));
  for (const name of sessionStates.keys()) {
    if (!activeNames.has(name)) {
      sessionStates.delete(name);
    }
  }

  const msg = JSON.stringify({
    type: 'sessions_changed',
    sessions: currentSessions
  });

  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(msg);
      } catch (e) {}
    }
  });
}

/**
 * Checks if tmux session list changed and broadcasts update if so
 */
export function checkSessionChanges() {
  if (!wssInstance || wssInstance.clients.size === 0) return;
  try {
    const currentSessions = listSessions();
    const signature = getSessionsSignature(currentSessions);
    if (signature !== lastSessionsHash) {
      broadcastSessionsList(currentSessions);
    }
  } catch (e) {}
}

/**
 * Broadcasts quota updates to all connected browser WebSockets
 * @param {Object} quota
 */
export function broadcastQuota(quota) {
  if (!wssInstance || !quota) return;
  const msg = JSON.stringify({
    type: 'quota_changed',
    quota
  });
  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(msg);
      } catch (e) {}
    }
  });
}

/**
 * Broadcasts notification state changes to all connected browser WebSockets
 * @param {string} session
 * @param {'settled'|'input'|null} state
 */
export function broadcastSessionNotification(session, state) {
  if (!wssInstance || !session) return;
  const msg = JSON.stringify({
    type: 'session_notification',
    session,
    state
  });
  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(msg);
      } catch (e) {}
    }
  });
}

/**
 * Handles incoming lifecycle events from Antigravity hooks
 * @param {Object} payload
 * @param {string} payload.event - 'pre_invocation' | 'stop' | 'ask_question'
 * @param {string} payload.session - session or directory name
 * @param {string} [payload.conversationId]
 * @param {string} [payload.toolCall]
 */
export function handleLifecycleHookEvent({ event, session, conversationId, toolCall }) {
  if (!session) return;

  console.log(`[LifecycleHook] Received event '${event}' for session '${session}'`);
  touchWakelock();

  if (event === 'pre_invocation') {
    // Agent started thinking/working: clear notification state
    sessionStates.set(session, null);
    broadcastSessionNotification(session, null);
  } else if (event === 'stop') {
    // Agent finished turn: notify turn completed
    sessionStates.set(session, 'settled');
    broadcastSessionNotification(session, 'settled');
  } else if (event === 'ask_question') {
    // Agent is waiting for user confirmation or input
    sessionStates.set(session, 'input');
    broadcastSessionNotification(session, 'input');
  }
}

/**
 * Mark that a user interaction started a turn (clears existing badge)
 * @param {string} sessionName
 */
export function markTurnStarted(sessionName) {
  if (!sessionName) return;
  sessionStates.set(sessionName, null);
  broadcastSessionNotification(sessionName, null);
}

/**
 * Clears active notification state for a session
 * @param {string} sessionName
 */
export function clearNotification(sessionName) {
  if (!sessionName) return;
  const prevState = sessionStates.get(sessionName);
  sessionStates.set(sessionName, null);
  if (prevState) {
    broadcastSessionNotification(sessionName, null);
  }
}

/**
 * Returns a map of all currently active notifications across sessions
 * @returns {Record<string, 'settled'|'input'>}
 */
export function getAllNotificationStates() {
  const states = {};
  for (const [name, state] of sessionStates.entries()) {
    if (state) {
      states[name] = state;
    }
  }
  return states;
}

/**
 * Initialize the session monitor with the WebSocket server instance and periodic polling
 * @param {import('ws').WebSocketServer} wss
 */
export function initSessionMonitor(wss) {
  wssInstance = wss;
  try {
    const initialSessions = listSessions();
    lastSessionsHash = getSessionsSignature(initialSessions);
  } catch (e) {}

  if (monitorInterval) {
    clearInterval(monitorInterval);
  }
  // Check tmux sessions every 1000ms to detect external creations/terminations/exits
  monitorInterval = setInterval(checkSessionChanges, 1000);
}

/**
 * Stops session monitor and polling timer
 */
export function stopSessionMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  sessionStates.clear();
  wssInstance = null;
}

export default {
  initSessionMonitor,
  stopSessionMonitor,
  broadcastSessionsList,
  checkSessionChanges,
  broadcastQuota,
  handleLifecycleHookEvent,
  markTurnStarted,
  clearNotification,
  getAllNotificationStates
};
