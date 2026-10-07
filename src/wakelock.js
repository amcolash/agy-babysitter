import { spawn, execSync } from 'child_process';
import os from 'os';
import config from './config.js';
let wakelockProcess = null;
let inactivityTimer = null;
let lastActiveTimestamp = null;
const TIMEOUT_MS = (config.WAKELOCK_TIMEOUT_MINUTES || 20) * 60 * 1000;
let lastTouch = 0;

/**
 * Spawns the OS-specific sleep/idle inhibitor process
 */
function spawnWakelockProcess() {
  // Always clean up any existing duplicate or orphan wakelocks first
  stopAllWakelocks();

  const platform = os.platform();
  let cmd = null;
  let args = [];

  if (platform === 'linux') {
    cmd = 'systemd-inhibit';
    args = ['--what=idle:sleep', '--who=agy-babysitter', '--why=Active notification session', 'sleep', 'infinity'];
  } else if (platform === 'darwin') {
    cmd = 'caffeinate';
    args = ['-d', '-i', '-m', '-u', '-w', String(process.pid)];
  }

  if (!cmd) {
    return null;
  }

  try {
    const proc = spawn(cmd, args, { stdio: 'ignore', detached: true });
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
    console.log(`[Wakelock] Released (no notifications received for ${config.WAKELOCK_TIMEOUT_MINUTES || 20}m)`);
    try {
      if (wakelockProcess.pid) {
        process.kill(-wakelockProcess.pid, 'SIGKILL');
      }
    } catch (e) {
      try {
        wakelockProcess.kill('SIGKILL');
      } catch (e2) {}
    }
    wakelockProcess = null;
  }
}

/**
 * Stops and kills all active wakelock processes system-wide
 */
export function stopAllWakelocks() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (wakelockProcess) {
    try {
      if (wakelockProcess.pid) {
        process.kill(-wakelockProcess.pid, 'SIGKILL');
      }
    } catch (e) {
      try {
        wakelockProcess.kill('SIGKILL');
      } catch (e2) {}
    }
    wakelockProcess = null;
  }

  // Terminate any systemd-inhibit processes created by agy-babysitter and their children
  try {
    const stdout = execSync("pgrep -f 'systemd-inhibit.*agy-babysitter' 2>/dev/null || true", {
      encoding: 'utf8'
    }).trim();
    if (stdout) {
      const pids = stdout.split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try {
          execSync(`pkill -9 -P ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
          process.kill(parseInt(pid, 10), 'SIGKILL');
        } catch (e) {}
      }
    }
  } catch (e) {}

  try {
    execSync("pkill -9 -f 'systemd-inhibit.*agy-babysitter' 2>/dev/null || true", { stdio: 'ignore' });
  } catch (e) {}

  try {
    execSync("pkill -9 -f 'caffeinate -d -i -m -u' 2>/dev/null || true", { stdio: 'ignore' });
  } catch (e) {}
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
  const remainingMs = (wakelockProcess && lastActiveTimestamp)
    ? Math.max(0, TIMEOUT_MS - (Date.now() - lastActiveTimestamp))
    : 0;
  return {
    active: !!wakelockProcess,
    timeoutMinutes: config.WAKELOCK_TIMEOUT_MINUTES || 20,
    lastActive: lastActiveTimestamp ? new Date(lastActiveTimestamp).toISOString() : null,
    remainingSeconds: Math.round(remainingMs / 1000)
  };
}

// Cleanup on process termination and crash handlers
function cleanupOnExit() {
  stopAllWakelocks();
}

process.on('exit', cleanupOnExit);

['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGABRT'].forEach((sig) => {
  process.on(sig, () => {
    cleanupOnExit();
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('[Server Crash] Uncaught Exception:', err);
  cleanupOnExit();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server Crash] Unhandled Rejection:', reason);
  cleanupOnExit();
  process.exit(1);
});
