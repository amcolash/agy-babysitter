import { execFile } from 'child_process';
import util from 'util';
import { WebSocket } from 'ws';
import { listSessions } from './zellij.js';

const execFileAsync = util.promisify(execFile);

const sessionTrackers = new Map();
let monitorInterval = null;
let wssInstance = null;

/**
 * Dump the viewport of a zellij session using `zellij action dump-screen`
 * @param {string} sessionName
 * @returns {Promise<string|null>}
 */
async function dumpSessionScreen(sessionName) {
  try {
    const { stdout } = await execFileAsync('zellij', ['-s', sessionName, 'action', 'dump-screen'], { timeout: 3000 });
    return stdout || '';
  } catch (err) {
    return null;
  }
}

/**
 * Checks if the terminal screen currently contains an active animated agy braille spinner (e.g. ⣷ Running command...)
 * @param {string} dumpText
 * @returns {boolean}
 */
export function hasAgyActiveSpinner(dumpText) {
  if (!dumpText) return false;
  const lines = dumpText.split('\n');
  return lines.some((l) => /^[\u2800-\u28FF]\s+\S+/.test(l.trim()));
}

/**
 * Extract lines strictly above the active prompt box
 * @param {string} dumpText
 * @returns {string}
 */
export function extractAbovePrompt(dumpText) {
  if (!dumpText) return '';
  const lines = dumpText.split('\n');
  const isDivider = (line) => /^[─━\-_=]{5,}/.test(line.trim());

  // Find last non-empty line
  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && !lines[lastNonEmpty].trim()) {
    lastNonEmpty--;
  }
  if (lastNonEmpty < 0) return '';

  // Scan backwards from last non-empty line to find the top divider of the prompt box
  const searchStart = lastNonEmpty;
  const searchEnd = Math.max(0, lastNonEmpty - 15);
  let topDividerIdx = -1;

  for (let i = searchStart; i >= searchEnd; i--) {
    if (isDivider(lines[i])) {
      topDividerIdx = i; // keep taking highest divider in the bottom cluster
    }
  }

  const cutoff = topDividerIdx !== -1 ? topDividerIdx : lastNonEmpty + 1;
  const start = Math.max(0, cutoff - 25);
  const contentLines = lines
    .slice(start, cutoff)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isDivider(l));

  return contentLines.join('\n').trim();
}

/**
 * Checks text above prompt for interactive question/permission prompts
 * @param {string} text
 * @returns {boolean}
 */
export function isWaitingForInput(text) {
  if (!text) return false;
  const lines = text.split('\n');
  const tailLines = lines.slice(-6);
  const tailText = tailLines.join('\n');

  // Question prompts starting with ?
  if (/\?\s+(Allow|Select|Choose|Do you|Run|Execute|Are you|Confirm|What|Which|Proceed)/i.test(tailText)) {
    return true;
  }

  // Bracket confirmations [Y/n], [y/N], (y/n), (Y/N), [yes/no]
  if (/(\[Y\/n\]|\[y\/N\]|\(y\/n\)|\(Y\/N\)|\[yes\/no\])/i.test(tailText)) {
    return true;
  }

  // Choice selector lines starting with ❯ or › or ● with options
  if (tailLines.some((l) => /^[❯›●\>\?]\s+/.test(l.trim()) && /(select|choose|arrow keys|option|allow|deny|approve)/i.test(tailText))) {
    return true;
  }

  // Interactive menu indicators
  if (/(press enter to continue|use arrow keys to navigate|select an option)/i.test(tailText)) {
    return true;
  }

  // Tool execution permission prompts
  if (/(allow\s+(tool|command|read|write|execution)|deny|do you want to proceed)/i.test(tailText)) {
    return true;
  }

  return false;
}

function getTracker(sessionName) {
  if (!sessionTrackers.has(sessionName)) {
    sessionTrackers.set(sessionName, {
      sessionName,
      isWorking: false,
      spinnerDisappearedAt: 0,
      notified: null
    });
  }
  return sessionTrackers.get(sessionName);
}

function broadcastSessionNotification(session, state) {
  if (!wssInstance) return;
  const msg = JSON.stringify({
    type: 'session_notification',
    session,
    state
  });
  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

let isPolling = false;
async function pollSessions() {
  if (isPolling) return;
  isPolling = true;
  try {
    const activeSessions = await listSessions();
    const activeNames = new Set(activeSessions.map((s) => s.name));

    // Clean up trackers for sessions that no longer exist
    for (const name of sessionTrackers.keys()) {
      if (!activeNames.has(name)) {
        sessionTrackers.delete(name);
      }
    }

    for (const session of activeSessions) {
      const name = session.name;
      const dump = await dumpSessionScreen(name);
      if (dump === null) continue;

      const tracker = getTracker(name);
      const isCurrentlyWorking = hasAgyActiveSpinner(dump);

      if (isCurrentlyWorking) {
        // Agy is actively working/thinking/running with animated braille spinner
        tracker.isWorking = true;
        tracker.spinnerDisappearedAt = 0;
      } else if (tracker.isWorking) {
        // Spinner is not visible on this frame
        const now = Date.now();
        if (!tracker.spinnerDisappearedAt) {
          tracker.spinnerDisappearedAt = now;
        }

        const abovePrompt = extractAbovePrompt(dump);
        const needsInput = isWaitingForInput(abovePrompt);
        // If waiting for input/permission, 1000ms is sufficient since execution is paused.
        // For turn completion, require 2500ms of sustained quiet to bridge intermediate tool transitions & LLM roundtrips.
        const requiredQuietMs = needsInput ? 1000 : 2500;

        if (now - tracker.spinnerDisappearedAt >= requiredQuietMs) {
          // Sustained quiet state reached! Turn is finished.
          tracker.isWorking = false;
          tracker.spinnerDisappearedAt = 0;

          if (needsInput) {
            if (tracker.notified !== 'input') {
              tracker.notified = 'input';
              broadcastSessionNotification(name, 'input');
            }
          } else if (tracker.notified !== 'settled') {
            tracker.notified = 'settled';
            broadcastSessionNotification(name, 'settled');
          }
        }
      }
    }
  } catch (err) {
    console.error('[SessionMonitor] Polling error:', err);
  } finally {
    isPolling = false;
  }
}

export function markTurnStarted(sessionName) {
  if (!sessionName) return;
  const tracker = getTracker(sessionName);
  tracker.notified = null;
  // NOTE: do not set tracker.isWorking = true here; let hasAgyActiveSpinner detect when agy begins work!
}

export function clearNotification(sessionName) {
  if (!sessionName) return;
  const tracker = getTracker(sessionName);
  tracker.notified = null;
  broadcastSessionNotification(sessionName, null);
}

export function getAllNotificationStates() {
  const states = {};
  for (const [name, tracker] of sessionTrackers.entries()) {
    if (tracker.notified) {
      states[name] = tracker.notified;
    }
  }
  return states;
}

export function initSessionMonitor(wss) {
  wssInstance = wss;
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = setInterval(pollSessions, 300);
  pollSessions().catch(() => {});
}

export function stopSessionMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export default {
  initSessionMonitor,
  stopSessionMonitor,
  markTurnStarted,
  clearNotification,
  getAllNotificationStates
};
