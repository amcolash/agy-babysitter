import { spawn } from 'child_process';
import os from 'os';
import config from './config.js';

let wakelockProcess = null;
let inactivityTimer = null;
let lastActiveTimestamp = Date.now();
const TIMEOUT_MS = (config.WAKELOCK_TIMEOUT_MINUTES || 20) * 60 * 1000;
let lastTouch = 0;

/**
 * Spawns the OS-specific sleep/idle inhibitor process
 */
function spawnWakelockProcess() {
  const platform = os.platform();
  let cmd = null;
  let args = [];

  if (platform === 'linux') {
    cmd = 'systemd-inhibit';
    args = ['--what=idle:sleep', '--who=agy-babysitter', '--why=Active terminal session', 'sleep', 'infinity'];
  } else if (platform === 'darwin') {
    cmd = 'caffeinate';
    args = ['-d', '-i', '-m', '-u'];
  }

  if (!cmd) {
    return null;
  }

  try {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('error', (err) => {
      console.warn(`[Wakelock] Failed to run ${cmd}:`, err.message);
      wakelockProcess = null;
    });
    proc.on('exit', () => {
      if (wakelockProcess === proc) {
        wakelockProcess = null;
      }
    });
    return proc;
  } catch (err) {
    console.warn(`[Wakelock] Error spawning ${cmd}:`, err.message);
    return null;
  }
}

/**
 * Starts or ensures the wakelock process is running
 */
export function startWakelock() {
  if (!wakelockProcess) {
    wakelockProcess = spawnWakelockProcess();
    if (wakelockProcess) {
      console.log(`[Wakelock] Active (inhibiting system sleep for ${config.WAKELOCK_TIMEOUT_MINUTES || 20}m)`);
    }
  }
}

/**
 * Releases the wakelock process and clears timers
 */
export function releaseWakelock() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (wakelockProcess) {
    console.log('[Wakelock] Released (inactivity timeout reached)');
    try {
      wakelockProcess.kill('SIGTERM');
    } catch (e) {}
    wakelockProcess = null;
  }
}

/**
 * Extends the wakelock on activity. Throttled to avoid excess timer resets during high-frequency I/O.
 * @param {boolean} [force=false] Force immediate reset without throttle
 */
export function touchWakelock(force = false) {
  const now = Date.now();
  lastActiveTimestamp = now;

  // If wakelock is not active, immediately start it
  if (!wakelockProcess) {
    startWakelock();
  }

  // Throttle timer reset to at most once every 5 seconds under heavy stream
  if (!force && inactivityTimer && (now - lastTouch < 5000)) {
    return;
  }
  lastTouch = now;

  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }

  inactivityTimer = setTimeout(() => {
    releaseWakelock();
  }, TIMEOUT_MS);
}

/**
 * Get the current status of the wakelock
 */
export function getWakelockStatus() {
  const remainingMs = wakelockProcess ? Math.max(0, TIMEOUT_MS - (Date.now() - lastActiveTimestamp)) : 0;
  return {
    active: !!wakelockProcess,
    timeoutMinutes: config.WAKELOCK_TIMEOUT_MINUTES || 20,
    lastActive: new Date(lastActiveTimestamp).toISOString(),
    remainingSeconds: Math.round(remainingMs / 1000)
  };
}

// Cleanup on process termination
function cleanupOnExit() {
  if (wakelockProcess) {
    try {
      wakelockProcess.kill('SIGTERM');
    } catch (e) {}
    wakelockProcess = null;
  }
}

process.on('exit', cleanupOnExit);
process.on('SIGINT', () => {
  cleanupOnExit();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupOnExit();
  process.exit(0);
});
