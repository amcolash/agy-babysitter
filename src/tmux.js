import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import config from './config.js';

const execFileAsync = util.promisify(execFile);

/**
 * Configure tmux global options for smooth mouse scrolling & large history buffer
 */
export async function ensureTmuxMouse() {
  try {
    await execFileAsync('tmux', ['set-option', '-g', 'mouse', 'on']);
    await execFileAsync('tmux', ['set-option', '-g', 'history-limit', '50000']);
  } catch (e) {
    // Ignore if tmux server is not running yet
  }
}

/**
 * Sanitize a string to be a valid tmux session name
 * @param {string} name 
 * @returns {string}
 */
export function sanitizeSessionName(name) {
  if (!name) return 'session';
  return name.trim().replace(/[^a-zA-Z0-9_\-\.]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

/**
 * List all active tmux sessions
 * @returns {Promise<Array<{name: string, windows: number, created: string, attached: boolean, path: string}>>}
 */
export async function listSessions() {
  try {
    const { stdout } = await execFileAsync('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}|#{session_path}'
    ]);

    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, windows, created, attached, sessionPath] = line.split('|');
        return {
          name,
          windows: parseInt(windows, 10) || 1,
          created: created ? new Date(parseInt(created, 10) * 1000).toISOString() : null,
          attached: attached === '1',
          path: sessionPath || config.DEFAULT_CWD
        };
      });
  } catch (err) {
    // If no server is running or no sessions, tmux exits with code 1
    return [];
  }
}

/**
 * Check if a tmux session exists
 * @param {string} name 
 * @returns {Promise<boolean>}
 */
export async function hasSession(name) {
  if (!name) return false;
  try {
    await execFileAsync('tmux', ['has-session', '-t', name]);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Generate a unique session name derived from folder path or base name.
 * If a session with that name exists, appends -2, -3, -4, etc.
 * @param {string} cwdOrName 
 * @returns {Promise<string>}
 */
export async function getUniqueSessionName(cwdOrName) {
  const base = sanitizeSessionName(path.basename(cwdOrName || config.DEFAULT_CWD));
  const sessions = await listSessions();
  const existingNames = new Set(sessions.map((s) => s.name));

  if (!existingNames.has(base)) {
    return base;
  }

  let counter = 2;
  while (existingNames.has(`${base}-${counter}`)) {
    counter++;
  }

  return `${base}-${counter}`;
}

/**
 * Create a new detached tmux session
 * @param {Object} options
 * @param {string} [options.name]
 * @param {string} [options.command]
 * @param {string} [options.cwd]
 * @returns {Promise<{name: string, created: boolean, message?: string}>}
 */
export async function createSession({ name, command, cwd }) {
  const sessionCwd = (cwd || config.DEFAULT_CWD).trim();
  const sessionCommand = (command || config.DEFAULT_COMMAND).trim();

  // If no name provided or name is provided, ensure unique name with hyphenation
  let sessionName = name ? sanitizeSessionName(name) : sanitizeSessionName(path.basename(sessionCwd));

  // If the session name already exists, automatically find the next available hyphenated suffix
  if (await hasSession(sessionName)) {
    sessionName = await getUniqueSessionName(sessionName);
  }

  const args = [
    'new-session',
    '-d',
    '-s', sessionName,
    '-c', sessionCwd
  ];

  if (sessionCommand) {
    args.push(sessionCommand);
  }

  await execFileAsync('tmux', args);
  await ensureTmuxMouse();
  return { name: sessionName, created: true, message: 'Session created successfully' };
}

/**
 * Kill a tmux session
 * @param {string} name 
 * @returns {Promise<boolean>}
 */
export async function killSession(name) {
  if (!name) return false;
  try {
    await execFileAsync('tmux', ['kill-session', '-t', name]);
    return true;
  } catch (err) {
    return false;
  }
}

export default {
  ensureTmuxMouse,
  sanitizeSessionName,
  listSessions,
  hasSession,
  getUniqueSessionName,
  createSession,
  killSession
};
