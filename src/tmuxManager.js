import { execSync, spawn } from 'child_process';
import pty from 'node-pty';
import path from 'path';
import fs from 'fs';
import config, { resolveTilde } from './config.js';
import { addRecentSession } from './recentSessions.js';

export function sanitizeSessionName(name) {
  if (!name) return 'session';
  return name.trim().replace(/[^a-zA-Z0-9_\-\.]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

/**
 * List all active tmux sessions
 * @returns {Array<{ name: string, cwd: string, attached: number, createdAt: number }>}
 */
export function listSessions() {
  try {
    const output = execSync(
      'tmux list-sessions -F "#{session_name}\t#{session_path}\t#{session_attached}\t#{session_created}" 2>/dev/null',
      { encoding: 'utf-8' }
    );
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, cwd, attached, createdAt] = line.split('\t');
        return {
          name,
          cwd: cwd || config.DEFAULT_CWD,
          attached: parseInt(attached, 10) || 0,
          createdAt: (parseInt(createdAt, 10) || 0) * 1000
        };
      });
  } catch (e) {
    return [];
  }
}

/**
 * Check if a tmux session exists
 * @param {string} name
 * @returns {boolean}
 */
export function hasSession(name) {
  if (!name) return false;
  try {
    execSync(`tmux has-session -t ${JSON.stringify(sanitizeSessionName(name))} 2>/dev/null`);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get session details by name
 * @param {string} name 
 */
export function getSession(name) {
  const sessions = listSessions();
  const target = sanitizeSessionName(name);
  return sessions.find((s) => s.name === target) || null;
}

/**
 * Generate a unique session name
 * @param {string} cwdOrName 
 */
export function getUniqueSessionName(cwdOrName) {
  const base = sanitizeSessionName(path.basename(cwdOrName || config.DEFAULT_CWD));
  if (!hasSession(base)) {
    return base;
  }
  let counter = 2;
  while (hasSession(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

/**
 * Apply global and session-specific tmux options (including disabling right-click popup menus)
 * @param {string} [sessionName] 
 */
export function applyTmuxGlobalOptions(sessionName) {
  try {
    execSync('tmux set-option -s escape-time 0 2>/dev/null || true');
    // Disable right-click menus so the terminal emulator's native context menu works cleanly
    execSync('tmux unbind-key -n MouseDown3Pane 2>/dev/null || true');
    execSync('tmux unbind-key -n M-MouseDown3Pane 2>/dev/null || true');
    execSync('tmux unbind-key -n MouseDown3Status 2>/dev/null || true');
    execSync('tmux unbind-key -n M-MouseDown3Status 2>/dev/null || true');
    execSync('tmux unbind-key -n MouseDown3StatusLeft 2>/dev/null || true');
    execSync('tmux unbind-key -n M-MouseDown3StatusLeft 2>/dev/null || true');
    execSync('tmux unbind-key -n MouseDown3StatusRight 2>/dev/null || true');
    execSync('tmux unbind-key -n M-MouseDown3StatusRight 2>/dev/null || true');
    execSync('tmux unbind-key -T copy-mode MouseDown3Pane 2>/dev/null || true');
    execSync('tmux unbind-key -T copy-mode-vi MouseDown3Pane 2>/dev/null || true');

    if (sessionName) {
      const s = JSON.stringify(sessionName);
      execSync(`tmux set-option -t ${s} history-limit 50000 2>/dev/null || true`);
      execSync(`tmux set-option -t ${s} mouse on 2>/dev/null || true`);
      execSync(`tmux set-option -t ${s} window-size latest 2>/dev/null || true`);
      execSync(`tmux set-option -t ${s} status off 2>/dev/null || true`);
      execSync(`tmux set-environment -t ${s} AGY_SESSION_NAME ${s} 2>/dev/null || true`);
    }
  } catch (e) {}
}

/**
 * Create a new background tmux session if it does not already exist
 * @param {Object} options
 * @param {string} [options.name]
 * @param {string} [options.cwd]
 * @param {string} [options.command]
 * @returns {{ name: string, cwd: string, created: boolean }}
 */
export function createSession({ name = config.DEFAULT_SESSION, cwd, command } = {}) {
  const sessionName = sanitizeSessionName(name);
  const targetCwd = resolveTilde(cwd || config.DEFAULT_CWD);
  const targetCommand = (command || config.DEFAULT_COMMAND || 'agy').trim();

  if (!fs.existsSync(targetCwd)) {
    fs.mkdirSync(targetCwd, { recursive: true });
  }

  if (hasSession(sessionName)) {
    applyTmuxGlobalOptions(sessionName);
    return { name: sessionName, cwd: targetCwd, created: false };
  }

  // Create detached tmux session running the target command
  execSync(
    `tmux new-session -d -s ${JSON.stringify(sessionName)} -c ${JSON.stringify(targetCwd)} ${JSON.stringify(targetCommand)}`,
    { env: { ...process.env, AGY_SESSION_NAME: sessionName } }
  );

  applyTmuxGlobalOptions(sessionName);
  addRecentSession(sessionName, targetCwd);

  return { name: sessionName, cwd: targetCwd, created: true };
}

/**
 * Terminate a tmux session
 * @param {string} name 
 * @returns {boolean}
 */
export function terminateSession(name) {
  const sessionName = sanitizeSessionName(name);
  if (!hasSession(sessionName)) {
    return false;
  }
  try {
    execSync(`tmux kill-session -t ${JSON.stringify(sessionName)} 2>/dev/null`);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Attach to a tmux session via node-pty for Web UI streaming
 * @param {Object} options
 * @param {string} options.sessionName
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 */
export function attachPtySession({ sessionName, cols = 100, rows = 30 }) {
  const name = sanitizeSessionName(sessionName);

  if (!hasSession(name)) {
    createSession({ name });
  }

  const ptyProcess = pty.spawn('tmux', ['attach-session', '-t', name], {
    name: 'xterm-256color',
    cols: Math.max(20, cols || 100),
    rows: Math.max(5, rows || 30),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGY_SESSION_NAME: name
    }
  });

  return ptyProcess;
}

export default {
  listSessions,
  hasSession,
  getSession,
  getUniqueSessionName,
  createSession,
  terminateSession,
  attachPtySession,
  sanitizeSessionName
};
