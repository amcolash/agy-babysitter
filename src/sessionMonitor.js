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
 * Extract lines strictly above the active prompt box
 * @param {string} dumpText
 * @returns {string}
 */
export function extractAbovePrompt(dumpText) {
  if (!dumpText) return '';
  const lines = dumpText.split('\n');
  const isDivider = (line) => /^[─━\-_=]{5,}/.test(line.trim());

  // Scan backwards from bottom to locate prompt divider lines
  const dividerIndices = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isDivider(lines[i])) {
      dividerIndices.push(i);
      if (dividerIndices.length >= 2) break;
    }
  }

  let cutoff = lines.length;
  if (dividerIndices.length >= 2) {
    cutoff = dividerIndices[1];
  } else if (dividerIndices.length === 1) {
    cutoff = dividerIndices[0];
  }

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
      lastSnapshot: null,
      currentContent: null,
      lastChangedAt: 0,
      settled: true,
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
      const abovePrompt = extractAbovePrompt(dump);

      // Initial discovery - set baseline without triggering notification
      if (tracker.lastSnapshot === null) {
        tracker.lastSnapshot = abovePrompt;
        tracker.currentContent = abovePrompt;
        tracker.settled = true;
        tracker.notified = null;
        continue;
      }

      const now = Date.now();
      if (abovePrompt !== tracker.currentContent) {
        // Output is actively changing
        tracker.currentContent = abovePrompt;
        tracker.lastChangedAt = now;
        tracker.settled = false;
      } else if (!tracker.settled && now - tracker.lastChangedAt >= 1000) {
        // Output stabilized!
        tracker.settled = true;

        if (abovePrompt && abovePrompt !== tracker.lastSnapshot) {
          tracker.lastSnapshot = abovePrompt;
          const needsInput = isWaitingForInput(abovePrompt);
          if (needsInput) {
            if (tracker.notified !== 'input') {
              tracker.notified = 'input';
              broadcastSessionNotification(name, 'input');
            }
          } else if (tracker.notified === null) {
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
  tracker.settled = false;
  tracker.lastChangedAt = Date.now();
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
  monitorInterval = setInterval(pollSessions, 800);
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
