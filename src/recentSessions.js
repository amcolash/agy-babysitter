import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveTilde, formatDisplayPath } from './config.js';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'agy-babysitter')
  : path.join(os.homedir(), '.config', 'agy-babysitter');
const RECENT_FILE = path.join(CONFIG_DIR, 'recent-sessions.json');
const MAX_RECENT_COUNT = 10;

/**
 * Load recent sessions from JSON file
 * @returns {Array<{name: string, cwd: string, command: string, lastUsed: number}>}
 */
export function loadRecentSessions() {
  try {
    if (fs.existsSync(RECENT_FILE)) {
      const raw = fs.readFileSync(RECENT_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        return data.filter(
          (item) => item && typeof item.name === 'string' && typeof item.cwd === 'string'
        );
      }
    }
  } catch (err) {
    console.warn('Failed to load recent sessions file:', err.message);
  }
  return [];
}

/**
 * Save recent sessions list to JSON file
 * @param {Array<Object>} sessions
 */
export function saveRecentSessions(sessions) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(RECENT_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save recent sessions file:', err.message);
  }
}

/**
 * Add or bump a session in the recent sessions history
 * @param {Object} entry
 * @param {string} entry.name
 * @param {string} entry.cwd
 * @param {string} [entry.command]
 * @returns {Array<Object>}
 */
export function addRecentSession({ name, cwd, command = 'agy' }) {
  if (!name || !cwd) return loadRecentSessions();

  const resolvedCwd = resolveTilde(cwd);
  const currentList = loadRecentSessions();

  // Deduplicate by name OR by cwd
  const filtered = currentList.filter(
    (item) => item.name !== name && item.cwd !== resolvedCwd
  );

  const newEntry = {
    name: name.trim(),
    cwd: resolvedCwd,
    command: (command || 'agy').trim(),
    lastUsed: Date.now()
  };

  filtered.unshift(newEntry);
  const trimmed = filtered.slice(0, MAX_RECENT_COUNT);
  saveRecentSessions(trimmed);
  return trimmed;
}

/**
 * Get formatted recent sessions list
 * @param {number} [limit=5]
 * @returns {Array<{name: string, cwd: string, command: string, displayPath: string, lastUsed: number}>}
 */
export function getRecentSessions(limit = 5) {
  const list = loadRecentSessions();

  // Only keep sessions whose directories still exist
  const validList = list.filter((item) => {
    try {
      return fs.existsSync(item.cwd);
    } catch {
      return false;
    }
  });

  return validList.slice(0, limit).map((s) => ({
    ...s,
    displayPath: formatDisplayPath(s.cwd)
  }));
}

export default {
  loadRecentSessions,
  saveRecentSessions,
  addRecentSession,
  getRecentSessions
};
