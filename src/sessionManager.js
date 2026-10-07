import pty from 'node-pty';
import path from 'path';
import fs from 'fs';
import os from 'os';
import config, { resolveTilde } from './config.js';
import { addRecentSession } from './recentSessions.js';

// Map of sessionName -> SessionObject
const activeSessions = new Map();

// Session meta cache file path (for persisting session metadata across restarts)
const CACHE_DIR = path.join(os.tmpdir(), 'agy-babysitter');
const META_FILE = path.join(CACHE_DIR, 'sessions-meta.json');

function loadMetaCache() {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function saveMetaCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const meta = {};
    for (const [name, sess] of activeSessions.entries()) {
      meta[name] = { cwd: sess.cwd, command: sess.command, createdAt: sess.createdAt };
    }
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  } catch (e) {}
}

export function sanitizeSessionName(name) {
  if (!name) return 'session';
  return name.trim().replace(/[^a-zA-Z0-9_\-\.]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

/**
 * Get a list of all active sessions
 * @returns {Array<{ name: string, cwd: string, command: string, createdAt: number, clientCount: number }>}
 */
export function listActiveSessions() {
  const result = [];
  for (const [name, sess] of activeSessions.entries()) {
    result.push({
      name,
      cwd: sess.cwd,
      command: sess.command,
      createdAt: sess.createdAt,
      clientCount: sess.clients.size
    });
  }
  return result;
}

/**
 * Check if a session exists
 * @param {string} name
 * @returns {boolean}
 */
export function hasSession(name) {
  return activeSessions.has(name);
}

/**
 * Get an active session by name
 * @param {string} name
 */
export function getSession(name) {
  return activeSessions.get(name) || null;
}

/**
 * Generate a unique session name
 * @param {string} cwdOrName
 * @returns {string}
 */
export function getUniqueSessionName(cwdOrName) {
  const base = sanitizeSessionName(path.basename(cwdOrName || config.DEFAULT_CWD));
  if (!activeSessions.has(base)) {
    return base;
  }
  let counter = 2;
  while (activeSessions.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

/**
 * Creates or retrieves a master PTY session
 * @param {Object} options
 * @param {string} [options.name]
 * @param {string} [options.cwd]
 * @param {string} [options.command]
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 */
export function createOrGetSession({
  name = config.DEFAULT_SESSION,
  cwd,
  command,
  cols = 120,
  rows = 35
} = {}) {
  const sessionName = sanitizeSessionName(name);

  if (activeSessions.has(sessionName)) {
    return activeSessions.get(sessionName);
  }

  const targetCwd = resolveTilde(cwd || config.DEFAULT_CWD);
  const targetCommand = (command || config.DEFAULT_COMMAND || 'agy').trim();

  if (!fs.existsSync(targetCwd)) {
    fs.mkdirSync(targetCwd, { recursive: true });
  }

  const shell = process.env.SHELL || '/bin/bash';

  const ptyProcess = pty.spawn(shell, ['-i'], {
    name: 'xterm-256color',
    cols: Math.max(20, cols || 120),
    rows: Math.max(5, rows || 35),
    cwd: targetCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLORFGBG: '15;0',
      FORCE_COLOR: '1',
      ZELLIJ_SESSION_NAME: sessionName, // Maintain compatibility with hooks
      AGY_SESSION_NAME: sessionName,
      LANG: process.env.LANG || 'en_US.UTF-8'
    }
  });

  const clients = new Set();
  const historyBuffer = [];
  let historySize = 0;
  const MAX_HISTORY_BYTES = 512 * 1024; // 512KB scrollback cache

  const session = {
    name: sessionName,
    cwd: targetCwd,
    command: targetCommand,
    createdAt: Date.now(),
    ptyProcess,
    clients,
    cols: cols || 120,
    rows: rows || 35,

    /**
     * Get scrollback buffer for initializing new client views
     */
    getHistory() {
      return historyBuffer.join('');
    },

    /**
     * Add a connected client (WebSocket or UNIX Socket)
     */
    addClient(client) {
      clients.add(client);
    },

    /**
     * Remove a client
     */
    removeClient(client) {
      clients.delete(client);
    },

    /**
     * Write input from any client to the master PTY
     */
    write(data) {
      try {
        ptyProcess.write(data);
      } catch (e) {}
    },

    /**
     * Resize master PTY
     */
    resize(newCols, newRows) {
      try {
        const c = Math.max(20, parseInt(newCols, 10) || 120);
        const r = Math.max(5, parseInt(newRows, 10) || 35);
        session.cols = c;
        session.rows = r;
        ptyProcess.resize(c, r);
      } catch (e) {}
    },

    /**
     * Terminate the session
     */
    kill() {
      try {
        ptyProcess.kill();
      } catch (e) {}
      activeSessions.delete(sessionName);
      saveMetaCache();
    }
  };

  ptyProcess.onData((data) => {
    // 1. Maintain scrollback history
    historyBuffer.push(data);
    historySize += data.length;
    while (historySize > MAX_HISTORY_BYTES && historyBuffer.length > 1) {
      const removed = historyBuffer.shift();
      historySize -= removed.length;
    }

    // 2. Broadcast output immediately to all connected clients
    for (const client of clients) {
      try {
        client.send(data);
      } catch (e) {}
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[SessionManager] Session '${sessionName}' exited (code: ${exitCode}, signal: ${signal})`);
    activeSessions.delete(sessionName);
    saveMetaCache();

    for (const client of clients) {
      try {
        if (typeof client.close === 'function') {
          client.close();
        }
      } catch (e) {}
    }
  });

  activeSessions.set(sessionName, session);
  saveMetaCache();
  addRecentSession({ name: sessionName, cwd: targetCwd, command: targetCommand });

  // Launch initial command in bash once spawned
  setTimeout(() => {
    try {
      ptyProcess.write(`export ZELLIJ_SESSION_NAME="${sessionName}" AGY_SESSION_NAME="${sessionName}"; exec ${targetCommand}\n`);
    } catch (e) {}
  }, 100);

  return session;
}

/**
 * Terminate and destroy an active session
 * @param {string} name
 */
export function terminateSession(name) {
  const session = activeSessions.get(name);
  if (session) {
    session.kill();
    return true;
  }
  return false;
}

export default {
  listActiveSessions,
  hasSession,
  getSession,
  getUniqueSessionName,
  createOrGetSession,
  terminateSession,
  sanitizeSessionName
};
