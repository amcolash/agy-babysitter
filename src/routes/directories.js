import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import config from '../config.js';

const router = express.Router();

/**
 * Format paths with ~ for user home
 * @param {string} fullPath
 * @returns {string}
 */
export function formatDisplayPath(fullPath) {
  const home = os.homedir();
  if (fullPath === home) return '~';
  if (fullPath.startsWith(home + '/')) {
    return '~' + fullPath.slice(home.length);
  }
  return fullPath;
}

/**
 * Validate that a target CWD is a direct 1-level child of an allowed root
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isAllowedDirectory(targetPath) {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);

  // Don't allow hidden folders
  const baseName = path.basename(resolved);
  if (baseName.startsWith('.')) {
    return false;
  }

  for (const allowedRoot of config.ALLOWED_DIRECTORIES) {
    const resolvedRoot = path.resolve(allowedRoot);
    // Direct 1-level child only (not the root itself)
    const parent = path.dirname(resolved);
    if (parent === resolvedRoot) {
      return true;
    }
  }

  return false;
}

// API: Get server & environment defaults
router.get('/info', (req, res) => {
  res.json({
    defaultSession: config.DEFAULT_SESSION,
    defaultCommand: config.DEFAULT_COMMAND,
    defaultCwd: config.DEFAULT_CWD,
    allowedDirectories: config.ALLOWED_DIRECTORIES.map(formatDisplayPath),
    homeDir: os.homedir()
  });
});

// API: List allowed root directories and their 1-level non-hidden children
router.get('/directories', async (req, res) => {
  try {
    const roots = [];

    for (const rootPath of config.ALLOWED_DIRECTORIES) {
      const resolvedRoot = path.resolve(rootPath);
      const displayRoot = formatDisplayPath(resolvedRoot);

      try {
        const stats = await fs.promises.stat(resolvedRoot);
        if (!stats.isDirectory()) continue;

        const entries = await fs.promises.readdir(resolvedRoot, { withFileTypes: true });
        const folders = entries
          .filter((entry) => {
            // Only 1-level non-hidden directories, excluding node_modules
            return entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules';
          })
          .map((entry) => ({
            name: entry.name,
            path: path.join(resolvedRoot, entry.name),
            displayPath: formatDisplayPath(path.join(resolvedRoot, entry.name))
          }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        roots.push({
          name: displayRoot,
          path: resolvedRoot,
          folders
        });
      } catch (err) {
        roots.push({
          name: displayRoot,
          path: resolvedRoot,
          folders: [],
          error: 'Directory not found or inaccessible'
        });
      }
    }

    res.json({
      roots,
      defaultCwd: config.DEFAULT_CWD
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
