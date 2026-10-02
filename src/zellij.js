import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import config from './config.js';

const execFileAsync = util.promisify(execFile);
const sessionMeta = new Map();

/**
 * Sanitize a string to be a valid zellij session name
 * @param {string} name 
 * @returns {string}
 */
export function sanitizeSessionName(name) {
  if (!name) return 'session';
  return name.trim().replace(/[^a-zA-Z0-9_\-\.]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

/**
 * List all active zellij sessions
 * @returns {Promise<Array<{name: string, created: string, attached: boolean, path: string}>>}
 */
export async function listSessions() {
  try {
    const { stdout } = await execFileAsync('zellij', ['list-sessions', '-n']);
    const lines = stdout.trim().split('\n');
    const sessions = [];

    for (const line of lines) {
      if (!line || !line.trim()) continue;

      // Extract session name before the "[" status block
      // Example: "my-session [Created 2m ago]" or "my-session [Created 10s ago] (EXITED - ...)"
      const parts = line.split('[');
      const sessionName = parts[0]?.trim();
      if (!sessionName) continue;

      const isExited = line.includes('EXITED') || line.includes('DEAD');
      if (isExited) {
        // Clean up dead session in background
        execFileAsync('zellij', ['delete-session', sessionName]).catch(() => {});
        continue;
      }

      const isAttached = line.includes('ATTACHED') || line.includes('Active');
      const meta = sessionMeta.get(sessionName) || {};

      sessions.push({
        name: sessionName,
        created: new Date().toISOString(),
        attached: isAttached,
        path: meta.cwd || config.DEFAULT_CWD
      });
    }

    return sessions;
  } catch (err) {
    // If no zellij sessions exist, zellij exits with non-zero
    return [];
  }
}

/**
 * Check if an active zellij session exists
 * @param {string} name 
 * @returns {Promise<boolean>}
 */
export async function hasSession(name) {
  if (!name) return false;
  const sessions = await listSessions();
  return sessions.some((s) => s.name === name);
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
 * Create a new detached zellij session
 * @param {Object} options
 * @param {string} [options.name]
 * @param {string} [options.command]
 * @param {string} [options.cwd]
 * @returns {Promise<{name: string, created: boolean, message?: string}>}
 */
export async function createSession({ name, command, cwd }) {
  const sessionCwd = (cwd || config.DEFAULT_CWD).trim();
  const sessionCommand = (command || config.DEFAULT_COMMAND).trim() || 'agy';

  let sessionName = name ? sanitizeSessionName(name) : sanitizeSessionName(path.basename(sessionCwd));

  if (await hasSession(sessionName)) {
    sessionName = await getUniqueSessionName(sessionName);
  }

  // Spawn zellij session detached in the background (-b)
  const args = ['attach', '-b', sessionName, '--', 'bash', '-c', sessionCommand];
  await execFileAsync('zellij', args, {
    cwd: sessionCwd
  });

  sessionMeta.set(sessionName, { cwd: sessionCwd, command: sessionCommand });
  return { name: sessionName, created: true, message: 'Session created successfully' };
}

/**
 * Kill a zellij session and clean up
 * @param {string} name 
 * @returns {Promise<boolean>}
 */
export async function killSession(name) {
  if (!name) return false;
  try {
    sessionMeta.delete(name);
    await execFileAsync('zellij', ['kill-session', name]).catch(() => {});
    await execFileAsync('zellij', ['delete-session', name]).catch(() => {});
    return true;
  } catch (err) {
    return false;
  }
}

export default {
  sanitizeSessionName,
  listSessions,
  hasSession,
  getUniqueSessionName,
  createSession,
  killSession
};
