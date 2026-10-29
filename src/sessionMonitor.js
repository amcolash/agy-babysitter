import path from 'path';
import { exec } from 'child_process';
import { WebSocket } from 'ws';
import { touchWakelock } from './wakelock.js';
import { listSessions } from './tmuxManager.js';
import { AUGMENTED_PATH } from './config.js';
import { pruneSessionLabels, getSessionLabels, onSessionLabelsChange } from './sessionLabels.js';

// Stores notification state per session: Map<sessionName, 'settled' | 'input' | null>
const sessionStates = new Map();
// Tracks consecutive misses when an 'input' state is active, to debounce clearing
const pendingInputMisses = new Map();
// Tracks sessions where the user actively dismissed the current prompt notification
const dismissedPromptSessions = new Set();
let wssInstance = null;
let monitorInterval = null;
let lastSessionsHash = '';
let unsubscribeLabels = null;

function getSessionsSignature(sessions) {
  return sessions.map((s) => `${s.name}:${s.cwd}`).sort().join('|');
}

/**
 * Pattern that detects Antigravity confirmation prompts or interactive questions
 * in the active prompt area of the visible terminal pane.
 * @param {string} paneContent
 * @returns {boolean}
 */
export function isPaneAwaitingConfirmation(paneContent) {
  if (!paneContent || typeof paneContent !== 'string') return false;

  // Inspect the bottom 15 lines of the visible pane where active prompts reside
  const lines = paneContent.split('\n').slice(-15).join('\n');

  // 1. Antigravity permission prompt headers
  const hasPermissionHeader = /Requesting permission (?:for|to)/i.test(lines);

  // 2. Specific permission questions
  const hasPermissionQuestion = /(?:Run this command\?|Allow access to this (?:file|URL)\?|Allow calling this tool\?|Do you want to (?:run|proceed|continue)\?)/i.test(lines);

  // 3. Choice options: must have an affirmative choice AND a cancellation choice
  const hasYesChoice = /(?:(?:>|\s)\s*1\.\s*Yes|\bYes,\s*(?:run|allow|proceed))\b/i.test(lines);
  const hasNoChoice = /(?:(?:>|\s)\s*2\.\s*No|\bNo,\s*cancel)\b/i.test(lines);
  const hasConfirmationChoices = hasYesChoice && hasNoChoice;

  // 4. Keyboard navigation hints commonly shown in prompt modals
  const hasNavigationHint = /(?:↑\/↓|Navigate\s*·)/i.test(lines);

  // 5. Numbered menu choices (e.g. "> 1. " followed by " 2. ")
  const hasMenuChoices = /(?:>|\s)\s*1\.\s+.*\n.*(?:>|\s)\s*2\.\s+/i.test(lines);

  // 6. Generic interactive CLI prompts (e.g. [y/n] or (Y/n) at end of prompt)
  const hasGenericPrompt = /(?:\[y\/n\]|\([yY]\/[nN]\))\s*$/im.test(lines);

  // Condition A: Standard Antigravity tool permission prompt (must have prompt header or question AND both confirmation choices)
  if ((hasPermissionHeader || hasPermissionQuestion) && hasConfirmationChoices) {
    return true;
  }

  // Condition B: Interactive choice menu (e.g. ask_question prompt with choices and navigation)
  if (hasNavigationHint && hasMenuChoices) {
    return true;
  }

  // Condition C: Generic CLI prompt waiting at prompt line
  if (hasGenericPrompt) {
    return true;
  }

  return false;
}

/**
 * Checks if a session's visible tmux pane is waiting for user confirmation or input
 * @param {string} sessionName
 * @returns {Promise<boolean>}
 */
export function checkSessionAwaitingInput(sessionName) {
  return new Promise((resolve) => {
    if (!sessionName) return resolve(false);
    exec(
      `tmux capture-pane -t "=${sessionName}:" -p`,
      { encoding: 'utf-8', timeout: 500, env: { ...process.env, PATH: AUGMENTED_PATH } },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve(false);
        }
        resolve(isPaneAwaitingConfirmation(stdout));
      }
    );
  });
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

  // Prune notification states and session labels for sessions that no longer exist
  const activeNames = new Set(currentSessions.map((s) => s.name));
  for (const name of sessionStates.keys()) {
    if (!activeNames.has(name)) {
      sessionStates.delete(name);
      pendingInputMisses.delete(name);
    }
  }
  pruneSessionLabels(Array.from(activeNames));

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
 * Broadcasts the current session labels to all connected WebSocket clients
 * @param {Record<string, string>} [labels]
 */
export function broadcastSessionLabels(labels = null) {
  if (!wssInstance) return;
  const currentLabels = labels || getSessionLabels();
  const msg = JSON.stringify({
    type: 'session_labels_changed',
    labels: currentLabels
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
 * Checks if tmux session list changed and inspects active sessions for permission prompts
 */
export async function checkSessionChanges() {
  try {
    const currentSessions = listSessions();
    const signature = getSessionsSignature(currentSessions);
    if (signature !== lastSessionsHash) {
      broadcastSessionsList(currentSessions);
    }

    // Inspect active session panes for permission prompts / interactive menus
    for (const session of currentSessions) {
      const awaiting = await checkSessionAwaitingInput(session.name);
      const currentState = sessionStates.get(session.name);

      if (awaiting) {
        pendingInputMisses.delete(session.name);
        // If user already dismissed notifications for this prompt, do not re-notify
        if (dismissedPromptSessions.has(session.name)) {
          continue;
        }
        if (currentState !== 'input') {
          sessionStates.set(session.name, 'input');
          broadcastSessionNotification(session.name, 'input');
        }
      } else {
        // Prompt is no longer on screen: reset dismissed status
        dismissedPromptSessions.delete(session.name);

        if (currentState === 'input') {
          // Confirmation prompt disappeared: after 2 consecutive checks, clear input state
          const misses = (pendingInputMisses.get(session.name) || 0) + 1;
          pendingInputMisses.set(session.name, misses);
          if (misses >= 2) {
            pendingInputMisses.delete(session.name);
            sessionStates.set(session.name, null);
            broadcastSessionNotification(session.name, null);
          }
        } else {
          pendingInputMisses.delete(session.name);
        }
      }
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
 * @param {string} [payload.workspacePath] - directory path of workspace
 * @param {string} [payload.conversationId]
 * @param {string} [payload.toolCall]
 */
export function handleLifecycleHookEvent({ event, session, workspacePath, conversationId, toolCall }) {
  const currentSessions = listSessions();
  let targetSession = null;
  const normalizedWp = workspacePath ? path.resolve(workspacePath) : null;

  // 1. Exact match: passed session name matches an active tmux session AND its cwd matches workspacePath
  if (session) {
    const sessionMatch = currentSessions.find((s) => s.name === session);
    if (sessionMatch) {
      if (!normalizedWp || (sessionMatch.cwd && path.resolve(sessionMatch.cwd) === normalizedWp)) {
        targetSession = sessionMatch.name;
      }
    }
  }

  // 2. Match by workspacePath if session cwd was mismatched or session not found
  if (!targetSession && normalizedWp) {
    const cwdMatches = currentSessions.filter((s) => s.cwd && path.resolve(s.cwd) === normalizedWp);
    if (cwdMatches.length === 1) {
      targetSession = cwdMatches[0].name;
    } else if (cwdMatches.length > 1) {
      const exactNameMatch = cwdMatches.find((s) => s.name === session);
      targetSession = exactNameMatch ? exactNameMatch.name : cwdMatches[0].name;
    }
  }

  // 3. Fallback to passed session name if it exists in currentSessions
  if (!targetSession && session && currentSessions.some((s) => s.name === session)) {
    targetSession = session;
  }

  // 4. Final fallback to passed session name
  if (!targetSession && session) {
    targetSession = session;
  }

  if (!targetSession) return;

  console.log(`[LifecycleHook] Received event '${event}' for session '${targetSession}' (original: '${session || ''}', workspace: '${workspacePath || ''}')`);
  touchWakelock();

  if (event === 'pre_invocation') {
    // Agent started thinking/working: clear notification state
    pendingInputMisses.delete(targetSession);
    dismissedPromptSessions.delete(targetSession);
    sessionStates.set(targetSession, null);
    broadcastSessionNotification(targetSession, null);
  } else if (event === 'stop') {
    // Agent finished turn: notify turn completed
    pendingInputMisses.delete(targetSession);
    dismissedPromptSessions.delete(targetSession);
    sessionStates.set(targetSession, 'settled');
    broadcastSessionNotification(targetSession, 'settled');
  } else if (event === 'ask_question' || (event === 'pre_tool_use' && toolCall === 'ask_question')) {
    // Agent is asking a question: user input is required
    pendingInputMisses.delete(targetSession);
    dismissedPromptSessions.delete(targetSession);
    sessionStates.set(targetSession, 'input');
    broadcastSessionNotification(targetSession, 'input');
  } else if (event === 'pre_tool_use') {
    // Agent called a tool (e.g. run_command, write_to_file) that might request permission.
    // Check tmux pane for confirmation prompts quickly.
    scheduleToolPermissionChecks(targetSession);
  } else if (event === 'post_tool_use') {
    // Tool completed: if session was in 'input' state, clear it
    if (sessionStates.get(targetSession) === 'input') {
      pendingInputMisses.delete(targetSession);
      sessionStates.set(targetSession, null);
      broadcastSessionNotification(targetSession, null);
    }
  }
}

/**
 * Schedules fast pane checks following a pre_tool_use hook event
 * @param {string} sessionName
 */
export function scheduleToolPermissionChecks(sessionName) {
  if (!sessionName) return;
  const delays = [100, 300, 700];
  for (const delay of delays) {
    setTimeout(async () => {
      // Don't overwrite if session has already changed to another state (like 'settled')
      if (sessionStates.get(sessionName) === 'settled') return;
      if (dismissedPromptSessions.has(sessionName)) return;
      const awaiting = await checkSessionAwaitingInput(sessionName);
      if (awaiting && sessionStates.get(sessionName) !== 'input') {
        pendingInputMisses.delete(sessionName);
        sessionStates.set(sessionName, 'input');
        broadcastSessionNotification(sessionName, 'input');
      }
    }, delay);
  }
}

/**
 * Mark that a user interaction started a turn (clears existing badge)
 * @param {string} sessionName
 */
export function markTurnStarted(sessionName) {
  if (!sessionName) return;
  pendingInputMisses.delete(sessionName);
  dismissedPromptSessions.delete(sessionName);
  sessionStates.set(sessionName, null);
  broadcastSessionNotification(sessionName, null);
}

/**
 * Clears active notification state for a session
 * @param {string} sessionName
 */
export function clearNotification(sessionName) {
  if (!sessionName) return;
  pendingInputMisses.delete(sessionName);
  dismissedPromptSessions.add(sessionName);
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

  if (unsubscribeLabels) {
    unsubscribeLabels();
  }
  unsubscribeLabels = onSessionLabelsChange((labels) => {
    broadcastSessionLabels(labels);
  });

  if (monitorInterval) {
    clearInterval(monitorInterval);
  }
  // Check tmux sessions and prompt states every 750ms
  monitorInterval = setInterval(checkSessionChanges, 750);
}

/**
 * Stops session monitor and polling timer
 */
export function stopSessionMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (unsubscribeLabels) {
    unsubscribeLabels();
    unsubscribeLabels = null;
  }
  sessionStates.clear();
  pendingInputMisses.clear();
  dismissedPromptSessions.clear();
  wssInstance = null;
}

export default {
  initSessionMonitor,
  stopSessionMonitor,
  broadcastSessionsList,
  broadcastSessionLabels,
  checkSessionChanges,
  broadcastQuota,
  handleLifecycleHookEvent,
  scheduleToolPermissionChecks,
  checkSessionAwaitingInput,
  isPaneAwaitingConfirmation,
  markTurnStarted,
  clearNotification,
  getAllNotificationStates
};
