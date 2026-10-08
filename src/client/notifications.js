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

export function clearSessionNotification(sessionName) {
  if (!sessionName) return;
  const s = sessionStates.get(sessionName);
  if (s && s.notified !== null) {
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
  if (prevState === state) return;
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
  let changed = false;
  for (const [name, state] of Object.entries(states)) {
    const s = getSessionState(name);
    if (s.notified !== state) {
      s.notified = state;
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

export function onSessionConnected(sessionName) {
  if (!sessionName) return;
  const state = getSessionState(sessionName);
  state.lastSnapshot = null;
  state.notified = null;
  clearSessionNotification(sessionName);
}

export function markTurnStarted(sessionName = null) {
  const target = sessionName || getCurrentSession();
  if (!target) return;
  unlockAudio();
  const s = sessionStates.get(target);
  if (s && s.notified !== null) {
    clearSessionNotification(target);
  }
}

export function handleUserInteraction() {
  unlockAudio();
  const current = getCurrentSession();
  if (current) {
    const s = sessionStates.get(current);
    if (s && s.notified !== null) {
      clearSessionNotification(current);
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

/**
 * Called on incoming terminal data
 */
export function onTerminalDataReceived(data) {
  // Terminal data hook (server handles turn and prompt detection)
}

/**
 * Initialize global interaction listeners to unlock audio, track resize, & clear notifications on any user action
 */
export function initNotifications() {
  const interactionEvents = [
    'click',
    'mousedown',
    'mouseup',
    'mousemove',
    'pointerdown',
    'pointermove',
    'keydown',
    'keyup',
    'touchstart',
    'touchend',
    'touchmove',
    'wheel',
    'focus'
  ];

  interactionEvents.forEach((ev) => {
    window.addEventListener(ev, handleUserInteraction, { passive: true });
  });

  window.addEventListener('resize', onTerminalResized, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleUserInteraction();
    }
  });

  window.addEventListener('focus', handleUserInteraction, { passive: true });
}
