import { getLinesAbovePrompt } from './terminal.js';
import { getCurrentSession, sendClearNotification } from './socket.js';

let audioCtx = null;
let audioUnlocked = false;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function unlockAudio() {
  if (audioUnlocked) return;
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        audioUnlocked = true;
      }).catch(() => {});
    } else {
      audioUnlocked = true;
    }
  }
}

/**
 * Play a synthesized warm, gentle acoustic chime
 */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Steep warm lowpass filter to produce a soft, organic wooden/tine timbre
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(850, now);
    filter.Q.setValueAtTime(0.5, now);
    filter.connect(ctx.destination);

    // Warm Rhodes / marimba voicing: F4 (349.23 Hz) -> C5 (523.25 Hz)
    const notes = [
      { freq: 349.23, delay: 0, gain: 0.038, len: 0.45 },
      { freq: 523.25, delay: 0.11, gain: 0.040, len: 0.55 }
    ];

    notes.forEach((note) => {
      const startTime = now + note.delay;

      // Fundamental tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, startTime);

      // Soft 25ms attack ramp and natural exponential decay
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(note.gain, startTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + note.len);

      osc.connect(gain);
      gain.connect(filter);

      osc.start(startTime);
      osc.stop(startTime + note.len);

      // Subtle warm second harmonic (faint body warmth)
      const harmonicOsc = ctx.createOscillator();
      const harmonicGain = ctx.createGain();
      harmonicOsc.type = 'sine';
      harmonicOsc.frequency.setValueAtTime(note.freq * 2, startTime);

      harmonicGain.gain.setValueAtTime(0.0001, startTime);
      harmonicGain.gain.linearRampToValueAtTime(note.gain * 0.15, startTime + 0.015);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0001, startTime + note.len * 0.4);

      harmonicOsc.connect(harmonicGain);
      harmonicGain.connect(filter);

      harmonicOsc.start(startTime);
      harmonicOsc.stop(startTime + note.len * 0.4);
    });

    // Mobile haptic vibration if supported (short subtle single tap)
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([20]);
    }
  } catch (e) {
    // Audio playback error (e.g. browser policy)
  }
}

export const playInputBellSound = playNotificationSound;
export const playSettledSound = playNotificationSound;

// Global pause and baseline sync during screen / window resizing
let isResizing = false;
let resizeTimeout = null;

export function onTerminalResized() {
  isResizing = true;
  if (debounceCheckTimer) {
    clearTimeout(debounceCheckTimer);
    debounceCheckTimer = null;
  }

  if (resizeTimeout) {
    clearTimeout(resizeTimeout);
  }

  // After resize reflow and screen redraw completely settles, silently capture the new baseline
  resizeTimeout = setTimeout(() => {
    isResizing = false;
    resizeTimeout = null;
    const sessionName = getCurrentSession();
    if (sessionName) {
      const state = getSessionState(sessionName);
      state.lastSnapshot = getAbovePromptText();
    }
  }, 500);
}

function isResizingActive() {
  return isResizing || resizeTimeout !== null;
}

// Session state storage: Map<sessionName, { lastSnapshot: string, notified: 'input'|'settled'|null }>
const sessionStates = new Map();

function getSessionState(sessionName) {
  if (!sessionStates.has(sessionName)) {
    sessionStates.set(sessionName, {
      lastSnapshot: null,
      notified: null
    });
  }
  return sessionStates.get(sessionName);
}

let onNotificationChangeCallback = null;

export function setNotificationChangeCallback(cb) {
  onNotificationChangeCallback = cb;
}

export function getSessionNotification(sessionName) {
  const s = sessionStates.get(sessionName);
  return s ? s.notified : null;
}

export function clearSessionNotification(sessionName) {
  if (!sessionName) return;
  const s = sessionStates.get(sessionName);
  if (s) {
    s.notified = null;
    updatePageTitle();
    if (onNotificationChangeCallback) {
      onNotificationChangeCallback(sessionName, null);
    }
    sendClearNotification(sessionName);
  }
}

export function handleServerSessionNotification(sessionName, state) {
  if (!sessionName) return;
  const s = getSessionState(sessionName);
  const prevState = s.notified;
  s.notified = state;
  updatePageTitle();
  if (onNotificationChangeCallback) {
    onNotificationChangeCallback(sessionName, state);
  }
  if (state && state !== prevState) {
    playNotificationSound();
  }
}

export function handleServerSessionNotificationsSync(states) {
  if (!states) return;
  for (const [name, state] of Object.entries(states)) {
    const s = getSessionState(name);
    s.notified = state;
  }
  updatePageTitle();
  if (onNotificationChangeCallback) {
    onNotificationChangeCallback(null, null);
  }
}

export function onSessionConnected(sessionName) {
  if (!sessionName) return;
  const state = getSessionState(sessionName);
  // Reset snapshot so initial buffer render is captured as baseline without sound
  state.lastSnapshot = null;
  state.notified = null;
  clearSessionNotification(sessionName);
}

export function markTurnStarted(sessionName = null) {
  const target = sessionName || getCurrentSession();
  if (!target) return;
  unlockAudio();
  clearSessionNotification(target);
}

export function handleUserInteraction() {
  unlockAudio();
  const current = getCurrentSession();
  if (current) {
    clearSessionNotification(current);
  }
}

function updatePageTitle() {
  const current = getCurrentSession();
  const currentNotif = current ? getSessionNotification(current) : null;

  if (currentNotif === 'input') {
    document.title = `🔔 [${current}] Input Needed | agy`;
    return;
  } else if (currentNotif === 'settled') {
    document.title = `✨ [${current}] Done | agy`;
    return;
  }

  // Check background sessions for any pending notifications
  let bgInputCount = 0;
  let bgSettledCount = 0;
  for (const [name, s] of sessionStates.entries()) {
    if (name !== current) {
      if (s.notified === 'input') bgInputCount++;
      else if (s.notified === 'settled') bgSettledCount++;
    }
  }

  if (bgInputCount > 0) {
    document.title = `🔔 (${bgInputCount}) Input Needed | agy`;
  } else if (bgSettledCount > 0) {
    document.title = `✨ (${bgSettledCount}) Done | agy`;
  } else {
    document.title = 'agy';
  }
}

function getAbovePromptText() {
  const lines = getLinesAbovePrompt(20);
  return (lines || []).join('\n').trim();
}

/**
 * Checks recent terminal lines strictly ABOVE the prompt to determine if agy is waiting for input or permission
 */
function isTerminalWaitingForInput() {
  const lines = getLinesAbovePrompt(15);
  if (!lines || lines.length === 0) return false;

  const tailLines = lines.slice(-6);
  const tailText = tailLines.join('\n');

  // Question prompts starting with ?
  if (/\?\s+(Allow|Select|Choose|Do you|Run|Execute|Are you|Confirm|What|Which|Proceed)/i.test(tailText)) {
    return true;
  }

  // Bracket confirmations [Y/n], [y/N], (y/n), (Y/N)
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

let debounceCheckTimer = null;

/**
 * Called on incoming terminal data
 */
export function onTerminalDataReceived(data) {
  if (isResizingActive()) return;

  const sessionName = getCurrentSession();
  if (!sessionName) return;

  // If ANSI bell character is encountered in data
  if (typeof data === 'string' && data.includes('\x07')) {
    triggerInputNotification(sessionName);
    return;
  }

  // Debounce check once stream slows down or pauses
  if (debounceCheckTimer) {
    clearTimeout(debounceCheckTimer);
  }

  debounceCheckTimer = setTimeout(() => {
    debounceCheckTimer = null;
    evaluateSessionSettlement(sessionName);
  }, 1200);
}

function evaluateSessionSettlement(sessionName) {
  if (isResizingActive()) return;

  const state = getSessionState(sessionName);
  const currentText = getAbovePromptText();

  // If first time encountering this session buffer (e.g. initial connection), set baseline without ringing
  if (state.lastSnapshot === null) {
    state.lastSnapshot = currentText;
    return;
  }

  // If content above prompt has NOT changed (e.g. user was typing in prompt box or cursor blinked), do nothing!
  if (currentText === state.lastSnapshot) {
    return;
  }

  // If the buffer was empty or undefined, do not notify
  if (!currentText) {
    return;
  }

  // New content arrived above prompt! Update snapshot baseline
  state.lastSnapshot = currentText;

  if (isTerminalWaitingForInput()) {
    triggerInputNotification(sessionName);
  } else if (state.notified === null) {
    triggerSettledNotification(sessionName);
  }
}

function triggerInputNotification(sessionName) {
  const state = getSessionState(sessionName);
  if (state.notified === 'input') return;

  state.notified = 'input';
  playInputBellSound();
  updatePageTitle();

  if (onNotificationChangeCallback) {
    onNotificationChangeCallback(sessionName, 'input');
  }
}

function triggerSettledNotification(sessionName) {
  const state = getSessionState(sessionName);
  if (state.notified !== null) return;

  state.notified = 'settled';
  playSettledSound();
  updatePageTitle();

  if (onNotificationChangeCallback) {
    onNotificationChangeCallback(sessionName, 'settled');
  }
}

/**
 * Initialize global interaction listeners to unlock audio, track resize, & clear notifications on user action
 */
export function initNotifications() {
  const interactionEvents = ['click', 'keydown', 'touchstart', 'mousedown'];
  interactionEvents.forEach((ev) => {
    window.addEventListener(ev, handleUserInteraction, { passive: true, capture: true });
  });

  window.addEventListener('resize', onTerminalResized, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      unlockAudio();
    }
  });
}
