import { getCurrentSession, sendClearNotification } from './socket.js';
import { getSetting } from './settings.js';

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

let lastSoundPlayedAt = 0;
const SOUND_THROTTLE_MS = 5000;

/**
 * Play a synthesized warm, gentle acoustic chime (throttled to at most once every 5 seconds)
 */
export function playNotificationSound() {
  try {
    // 1. Mobile haptic vibration if enabled
    if (getSetting('vibrationEnabled') !== false) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([20]);
      }
    }

    // 2. Audio chime if enabled
    if (!getSetting('soundEnabled')) {
      return;
    }
    const now = Date.now();

    // Check in-memory throttle
    if (now - lastSoundPlayedAt < SOUND_THROTTLE_MS) {
      return;
    }

    // Check cross-browser-tab throttle via localStorage
    try {
      const stored = parseInt(localStorage.getItem('agy_last_ding_time') || '0', 10);
      if (now - stored < SOUND_THROTTLE_MS) {
        lastSoundPlayedAt = stored;
        return;
      }
      localStorage.setItem('agy_last_ding_time', String(now));
    } catch (e) {}

    lastSoundPlayedAt = now;

    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const audioTime = ctx.currentTime;

    // Steep warm lowpass filter to produce a soft, organic wooden/tine timbre
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(850, audioTime);
    filter.Q.setValueAtTime(0.5, audioTime);
    filter.connect(ctx.destination);

    // Warm Rhodes / marimba voicing: F4 (349.23 Hz) -> C5 (523.25 Hz)
    const notes = [
      { freq: 349.23, delay: 0, gain: 0.038, len: 0.45 },
      { freq: 523.25, delay: 0.11, gain: 0.040, len: 0.55 }
    ];

    notes.forEach((note) => {
      const startTime = audioTime + note.delay;

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

export function onTerminalResized() {
  // Terminal resize hook
}

// Session state storage: Map<sessionName, { lastSnapshot: string, notified: 'input'|'settled'|null }>
const sessionStates = new Map();

function getSessionState(sessionName) {
  if (!sessionStates.has(sessionName)) {
    sessionStates.set(sessionName, {
      lastSnapshot: null,
      notified: null,
      notifiedAt: 0
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

export function pruneSessionNotifications(validSessionNames) {
  if (!Array.isArray(validSessionNames)) return;
  const valid = new Set(validSessionNames);
  let changed = false;
  for (const name of sessionStates.keys()) {
    if (!valid.has(name)) {
      sessionStates.delete(name);
      changed = true;
    }
  }
  if (changed) {
    updatePageTitle();
    if (onNotificationChangeCallback) {
      onNotificationChangeCallback(null, null);
    }
  }
}

let focusDismissTimer = null;

export function cancelFocusDismissTimer() {
  if (focusDismissTimer) {
    clearTimeout(focusDismissTimer);
    focusDismissTimer = null;
  }
}

export function scheduleFocusDismiss(sessionName, delayMs = 3000) {
  if (!sessionName) return;
  cancelFocusDismissTimer();
  focusDismissTimer = setTimeout(() => {
    focusDismissTimer = null;
    if (getCurrentSession() === sessionName) {
      clearSessionNotification(sessionName);
    }
  }, delayMs);
}

export function clearSessionNotification(sessionName) {
  if (!sessionName) return;
  if (getCurrentSession() === sessionName) {
    cancelFocusDismissTimer();
    resetMouseOrigin();
  }
  const s = sessionStates.get(sessionName);
  if (s && s.notified !== null) {
    s.notified = null;
    s.notifiedAt = 0;
    updatePageTitle();
    if (onNotificationChangeCallback) {
      onNotificationChangeCallback(sessionName, null);
    }
    sendClearNotification(sessionName);
  }
}

export function renameSessionNotification(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  if (sessionStates.has(oldName)) {
    sessionStates.set(newName, sessionStates.get(oldName));
    sessionStates.delete(oldName);
    updatePageTitle();
  }
}

export function handleServerSessionNotification(sessionName, state) {
  if (!sessionName) return;
  const s = getSessionState(sessionName);
  const prevState = s.notified;
  if (prevState === state) return;
  s.notified = state;
  s.notifiedAt = state ? Date.now() : 0;
  updatePageTitle();
  if (onNotificationChangeCallback) {
    onNotificationChangeCallback(sessionName, state);
  }
  if (state && state !== prevState) {
    playNotificationSound();
  }
  if (!state && getCurrentSession() === sessionName) {
    cancelFocusDismissTimer();
  }
  // If notification arrived while this tab is active, auto-clear after 3 seconds on the tab
  if (state && getCurrentSession() === sessionName) {
    scheduleFocusDismiss(sessionName, 3000);
  }
}

export function handleServerSessionNotificationsSync(states) {
  if (!states) return;
  let changed = false;
  const current = getCurrentSession();
  for (const [name, state] of Object.entries(states)) {
    const s = getSessionState(name);
    if (s.notified !== state) {
      s.notified = state;
      s.notifiedAt = state ? Date.now() : 0;
      changed = true;
    }
    if (!state && current === name) {
      cancelFocusDismissTimer();
    }
    if (state && current === name) {
      scheduleFocusDismiss(name, 3000);
    }
  }
  if (changed) {
    updatePageTitle();
    if (onNotificationChangeCallback) {
      onNotificationChangeCallback(null, null);
    }
  }
}

export function onSessionConnected(sessionName) {
  if (!sessionName) return;
  const state = getSessionState(sessionName);
  state.lastSnapshot = null;
  state.focusedAt = Date.now();
  // Preserve notification state on connect so the bell remains visible until actual user interaction
}

let mouseOriginX = null;
let mouseOriginY = null;

export function resetMouseOrigin() {
  mouseOriginX = null;
  mouseOriginY = null;
}

function handleMouseMove(e) {
  if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
  const current = getCurrentSession();
  if (!current) {
    mouseOriginX = null;
    mouseOriginY = null;
    return;
  }

  const s = sessionStates.get(current);
  if (!s || s.notified === null) {
    mouseOriginX = null;
    mouseOriginY = null;
    return;
  }

  // Grace period during tab switch so the initial click to switch tabs does not immediately clear
  if (s.focusedAt && Date.now() - s.focusedAt < 300) {
    mouseOriginX = e.clientX;
    mouseOriginY = e.clientY;
    return;
  }

  if (mouseOriginX === null || mouseOriginY === null) {
    mouseOriginX = e.clientX;
    mouseOriginY = e.clientY;
    return;
  }

  const dist = Math.hypot(e.clientX - mouseOriginX, e.clientY - mouseOriginY);
  if (dist > 10) {
    mouseOriginX = null;
    mouseOriginY = null;
    clearSessionNotification(current);
  }
}

function handleTouchMove(e) {
  if (e && e.touches && e.touches.length > 0) {
    handleMouseMove(e.touches[0]);
  }
}

export function onSessionFocused(sessionName) {
  if (!sessionName) return;
  const s = getSessionState(sessionName);
  s.focusedAt = Date.now();

  cancelFocusDismissTimer();
  resetMouseOrigin();

  // If this session has an active notification, clear after 3 seconds on the tab
  if (s.notified !== null) {
    scheduleFocusDismiss(sessionName, 3000);
  }
}

export function markTurnStarted(sessionName = null) {
  clientStreamBuffer = '';
  const target = sessionName || getCurrentSession();
  if (!target) return;
  cancelFocusDismissTimer();
  resetMouseOrigin();
  unlockAudio();
  const s = sessionStates.get(target);
  if (s && s.notified !== null) {
    clearSessionNotification(target);
  }
}

export function handleUserInteraction(e) {
  unlockAudio();
  const current = getCurrentSession();
  if (current) {
    const s = sessionStates.get(current);
    if (!s || s.notified === null) return;

    // As soon as the user types (keyboard press), clear the notification immediately!
    if (e && e.type === 'keydown') {
      clearSessionNotification(current);
      return;
    }

    // Clicking / pointerdown / mousedown / touchstart clears the notification immediately!
    if (e && (e.type === 'pointerdown' || e.type === 'touchstart' || e.type === 'mousedown')) {
      // Grace period if this click was the one that switched to this tab within the last 300ms
      if (s.focusedAt && Date.now() - s.focusedAt < 300) {
        return;
      }
      clearSessionNotification(current);
      return;
    }
  }
}

function updatePageTitle() {
  const current = getCurrentSession();
  const currentNotif = current ? getSessionNotification(current) : null;

  if (currentNotif) {
    document.title = `🔔 [${current}] ${currentNotif === 'input' ? 'Input Needed' : 'Done'} | agy`;
    return;
  }

  // Check background sessions for any pending notifications
  let bgNotifCount = 0;
  for (const [name, s] of sessionStates.entries()) {
    if (name !== current && s.notified) {
      bgNotifCount++;
    }
  }

  if (bgNotifCount > 0) {
    document.title = `🔔 (${bgNotifCount}) Alert | agy`;
  } else {
    document.title = 'agy';
  }
}

let clientStreamBuffer = '';

/**
 * Called on incoming terminal data
 */
export function onTerminalDataReceived(data) {
  if (!data || typeof data !== 'string') return;
  const current = getCurrentSession();
  if (!current) return;

  const clean = data
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\].*?(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, ' ');

  clientStreamBuffer = (clientStreamBuffer + clean).slice(-4096);

  // Hard stop: show notification if "Requesting permission for" or "Requesting permission to" is newly streamed
  if (/Requesting permission (?:for|to)/i.test(clientStreamBuffer)) {
    const s = getSessionState(current);
    if (s.notified !== 'input') {
      s.notified = 'input';
      s.notifiedAt = Date.now();
      updatePageTitle();
      if (onNotificationChangeCallback) {
        onNotificationChangeCallback(current, 'input');
      }
      playNotificationSound();
      scheduleFocusDismiss(current, 3000);
    }
  }
}

/**
 * Initialize interaction listeners to unlock audio and clear notifications on genuine user interaction
 */
export function initNotifications() {
  // Clear notification on genuine user actions (keyboard typing, clicking, touch, or mouse movement > 10px)
  const realInteractionEvents = [
    'keydown',
    'pointerdown',
    'mousedown',
    'touchstart'
  ];

  realInteractionEvents.forEach((ev) => {
    window.addEventListener(ev, handleUserInteraction, { capture: true, passive: true });
  });

  // Track mouse and touch movement to clear notifications if moved > 10px
  window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: true });
  window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });

  // AudioContext unlock on initial user gesture without clearing notifications
  const gestureEvents = ['click', 'keydown', 'touchstart'];
  gestureEvents.forEach((ev) => {
    window.addEventListener(ev, unlockAudio, { passive: true });
  });

  window.addEventListener('resize', onTerminalResized, { passive: true });
}
