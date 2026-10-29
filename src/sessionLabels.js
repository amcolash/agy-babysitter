import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'agy-babysitter')
  : path.join(os.homedir(), '.config', 'agy-babysitter');
const LABELS_FILE = path.join(CONFIG_DIR, 'session-labels.json');

let cachedLabels = null;
const changeListeners = new Set();

/**
 * Load session labels from disk
 * @returns {Record<string, string>}
 */
export function loadSessionLabels() {
  try {
    if (fs.existsSync(LABELS_FILE)) {
      const raw = fs.readFileSync(LABELS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const cleaned = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
            cleaned[k.trim()] = v.trim();
          }
        }
        cachedLabels = cleaned;
        return cleaned;
      }
    }
  } catch (err) {
    console.warn('Failed to load session labels file:', err.message);
  }
  cachedLabels = {};
  return cachedLabels;
}

/**
 * Persist session labels to disk
 * @param {Record<string, string>} labels
 */
export function saveSessionLabels(labels) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save session labels file:', err.message);
  }
}

/**
 * Notify all registered change listeners
 * @param {Record<string, string>} labels 
 */
function notifyListeners(labels) {
  for (const listener of changeListeners) {
    try {
      listener(labels);
    } catch (e) {
      console.warn('Error in session label listener:', e);
    }
  }
}

/**
 * Subscribe to session label changes
 * @param {(labels: Record<string, string>) => void} callback 
 * @returns {() => void} unsubscribe function
 */
export function onSessionLabelsChange(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

/**
 * Get all session labels
 * @returns {Record<string, string>}
 */
export function getSessionLabels() {
  if (cachedLabels === null) {
    loadSessionLabels();
  }
  return { ...cachedLabels };
}

/**
 * Get label for a specific session
 * @param {string} sessionName 
 * @returns {string}
 */
export function getSessionLabel(sessionName) {
  if (!sessionName) return '';
  const labels = getSessionLabels();
  return typeof labels[sessionName] === 'string' ? labels[sessionName] : '';
}

/**
 * Set or clear label for a session
 * @param {string} sessionName 
 * @param {string} label 
 * @returns {Record<string, string>} updated labels
 */
export function setSessionLabel(sessionName, label) {
  if (!sessionName) return getSessionLabels();
  const labels = { ...getSessionLabels() };
  const trimmed = typeof label === 'string' ? label.trim() : '';

  if (trimmed) {
    if (labels[sessionName] === trimmed) {
      return labels;
    }
    labels[sessionName] = trimmed;
  } else {
    if (!(sessionName in labels)) {
      return labels;
    }
    delete labels[sessionName];
  }

  cachedLabels = labels;
  saveSessionLabels(labels);
  notifyListeners(labels);
  return labels;
}

/**
 * Remove label for a session
 * @param {string} sessionName 
 * @returns {Record<string, string>}
 */
export function removeSessionLabel(sessionName) {
  return setSessionLabel(sessionName, '');
}

/**
 * Prune labels for sessions that no longer exist
 * @param {string[]} validSessionNames 
 * @returns {Record<string, string>}
 */
export function pruneSessionLabels(validSessionNames) {
  if (!Array.isArray(validSessionNames)) return getSessionLabels();
  const labels = { ...getSessionLabels() };
  const validSet = new Set(validSessionNames);
  let changed = false;

  for (const name of Object.keys(labels)) {
    if (!validSet.has(name)) {
      delete labels[name];
      changed = true;
    }
  }

  if (changed) {
    cachedLabels = labels;
    saveSessionLabels(labels);
    notifyListeners(labels);
  }

  return labels;
}
