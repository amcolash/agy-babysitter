import { execFile } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import config, { resolveTilde } from './config.js';
import { addRecentSession } from './recentSessions.js';

const execFileAsync = util.promisify(execFile);
export const sessionMeta = new Map();

// Session meta cache file path
const CACHE_DIR = path.join(os.tmpdir(), 'agy-babysitter');
const META_FILE = path.join(CACHE_DIR, 'sessions-meta.json');

function loadMetaCache() {
  try {
    if (fs.existsSync(META_FILE)) {
      const data = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
      for (const [key, val] of Object.entries(data)) {
        if (!sessionMeta.has(key)) {
          sessionMeta.set(key, val);
        }
      }
    }
  } catch (e) {}
}

function saveMetaCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(sessionMeta);
    fs.writeFileSync(META_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (e) {}
}

// Initial load
loadMetaCache();

/**
 * Infer CWD from session name if not in metadata cache
 * @param {string} sessionName
 * @returns {string}
 */
function inferCwdFromSessionName(sessionName) {
  if (!sessionName) return config.DEFAULT_CWD;

  // Strip trailing -2, -3, etc. for matching
  const base = sessionName.replace(/-\d+$/, '');

  for (const root of config.ALLOWED_DIRECTORIES) {
    const candidate = path.join(root, base);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return config.DEFAULT_CWD;
}

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
  loadMetaCache();
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
        // Clean up dead session in background with force flag
        sessionMeta.delete(sessionName);
        saveMetaCache();
        execFileAsync('zellij', ['delete-session', '-f', sessionName]).catch(() => {});
        continue;
      }

      const isAttached = line.includes('ATTACHED') || line.includes('Active');
      const meta = sessionMeta.get(sessionName) || {};
      const sessionPath = meta.cwd || inferCwdFromSessionName(sessionName);

      if (sessionPath && fs.existsSync(sessionPath)) {
        addRecentSession({
          name: sessionName,
          cwd: sessionPath,
          command: meta.command || config.DEFAULT_COMMAND
        });
      }

      sessions.push({
        name: sessionName,
        created: new Date().toISOString(),
        attached: isAttached,
        path: sessionPath
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
 * Wraps a command string to ensure full ANSI & 24-bit TrueColor support inside Zellij panes
 * @param {string} cmd
 * @returns {string}
 */
export function wrapCommandWithColorEnv(cmd) {
  const target = (cmd || config.DEFAULT_COMMAND || 'agy').trim();
  return `export TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=1 CLICOLOR=1 CLICOLOR_FORCE=1; exec ${target}`;
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
  const sessionCwd = resolveTilde((cwd || config.DEFAULT_CWD).trim());
  const sessionCommand = (command || config.DEFAULT_COMMAND).trim() || 'agy';
  const wrappedCommand = wrapCommandWithColorEnv(sessionCommand);

  let sessionName = name ? sanitizeSessionName(name) : sanitizeSessionName(path.basename(sessionCwd));

  if (await hasSession(sessionName)) {
    sessionName = await getUniqueSessionName(sessionName);
  }

  // Spawn zellij session detached in the background (-b) with full color support
  const args = ['attach', '-b', sessionName, '--', 'bash', '-c', wrappedCommand];
  await execFileAsync('zellij', args, {
    cwd: sessionCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLORFGBG: '15;0',
      FORCE_COLOR: '1',
      LANG: process.env.LANG || 'en_US.UTF-8'
    }
  });

  sessionMeta.set(sessionName, { cwd: sessionCwd, command: sessionCommand });
  saveMetaCache();
  addRecentSession({ name: sessionName, cwd: sessionCwd, command: sessionCommand });
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
    saveMetaCache();
    await execFileAsync('zellij', ['delete-session', '-f', name]).catch(() => {});
    return true;
  } catch (err) {
    return false;
  }
}

export default {
  sessionMeta,
  sanitizeSessionName,
  listSessions,
  hasSession,
  getUniqueSessionName,
  createSession,
  killSession
};
