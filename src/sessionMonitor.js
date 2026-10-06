import { WebSocket } from 'ws';

const sessionTrackers = new Map();
let wssInstance = null;

/**
 * Checks if the terminal data chunk contains an active animated agy braille spinner (e.g. ⣷ Running command...)
 * @param {string} text
 * @returns {boolean}
 */
export function hasAgyActiveSpinner(text) {
  if (!text) return false;
  return /[\u2800-\u28FF]\s+\S+/.test(text);
}

/**
 * Checks text for interactive question/permission prompts
 * @param {string} text
 * @returns {boolean}
 */
export function isWaitingForInput(text) {
  if (!text) return false;

  // Question prompts starting with ?
  if (/\?\s+(Allow|Select|Choose|Do you|Run|Execute|Are you|Confirm|What|Which|Proceed)/i.test(text)) {
    return true;
  }

  // Bracket confirmations [Y/n], [y/N], (y/n), (Y/N), [yes/no]
  if (/(\[Y\/n\]|\[y\/N\]|\(y\/n\)|\(Y\/N\)|\[yes\/no\])/i.test(text)) {
    return true;
  }

  // Choice selector lines starting with ❯ or › or ● with options
  if (/(^[❯›●\>\?]\s+.*(select|choose|arrow keys|option|allow|deny|approve))/im.test(text)) {
    return true;
  }

  // Interactive menu indicators
  if (/(press enter to continue|use arrow keys to navigate|select an option)/i.test(text)) {
    return true;
  }

  // Tool execution permission prompts
  if (/(allow\s+(tool|command|read|write|execution)|deny|do you want to proceed)/i.test(text)) {
    return true;
  }

  return false;
}

function getTracker(sessionName) {
  if (!sessionTrackers.has(sessionName)) {
    sessionTrackers.set(sessionName, {
      sessionName,
      isWorking: false,
      settleTimer: null,
      recentText: '',
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

/**
 * Feed live PTY output stream data into the session turn detector without any IPC polling
 * @param {string} sessionName
 * @param {string} rawChunk
 */
export function feedSessionStream(sessionName, rawChunk) {
  if (!sessionName || !rawChunk) return;
  const tracker = getTracker(sessionName);

  const hasSpinner = hasAgyActiveSpinner(rawChunk);

  if (hasSpinner) {
    tracker.isWorking = true;
    if (tracker.settleTimer) {
      clearTimeout(tracker.settleTimer);
      tracker.settleTimer = null;
    }
    const cleanChunk = typeof rawChunk === 'string'
      ? rawChunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '')
      : '';
    tracker.recentText = (tracker.recentText + cleanChunk).slice(-4000);
  } else if (tracker.isWorking) {
    // If working but this frame has no spinner, append clean text and restart quiet countdown
    const cleanChunk = typeof rawChunk === 'string'
      ? rawChunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '')
      : '';
    tracker.recentText = (tracker.recentText + cleanChunk).slice(-4000);

    if (tracker.settleTimer) {
      clearTimeout(tracker.settleTimer);
    }

    const needsInput = isWaitingForInput(tracker.recentText);
    const quietMs = needsInput ? 1000 : 2500;

    tracker.settleTimer = setTimeout(() => {
      tracker.isWorking = false;
      tracker.settleTimer = null;

      const inputCheck = isWaitingForInput(tracker.recentText);
      if (inputCheck) {
        if (tracker.notified !== 'input') {
          tracker.notified = 'input';
          broadcastSessionNotification(sessionName, 'input');
        }
      } else if (tracker.notified !== 'settled') {
        tracker.notified = 'settled';
        broadcastSessionNotification(sessionName, 'settled');
      }
    }, quietMs);
  }
}

export function markTurnStarted(sessionName) {
  if (!sessionName) return;
  const tracker = sessionTrackers.get(sessionName);
  if (!tracker) return;
  tracker.notified = null;
  if (tracker.settleTimer) {
    clearTimeout(tracker.settleTimer);
    tracker.settleTimer = null;
  }
}

export function clearNotification(sessionName) {
  if (!sessionName) return;
  const tracker = sessionTrackers.get(sessionName);
  if (!tracker) return;
  const wasNotified = tracker.notified;
  tracker.notified = null;
  if (tracker.settleTimer) {
    clearTimeout(tracker.settleTimer);
    tracker.settleTimer = null;
  }
  if (wasNotified !== null) {
    broadcastSessionNotification(sessionName, null);
  }
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
}

export function stopSessionMonitor() {
  for (const tracker of sessionTrackers.values()) {
    if (tracker.settleTimer) {
      clearTimeout(tracker.settleTimer);
      tracker.settleTimer = null;
    }
  }
  sessionTrackers.clear();
}

export default {
  initSessionMonitor,
  stopSessionMonitor,
  feedSessionStream,
  markTurnStarted,
  clearNotification,
  getAllNotificationStates
};
