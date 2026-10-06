import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import config, { resolveTilde, formatDisplayPath } from '../config.js';

const router = express.Router();

export { formatDisplayPath };

/**
 * Validate that a target CWD is a direct 1-level child of an allowed root
 * @param {string} targetPath
 * @returns {boolean}
 */
export function isAllowedDirectory(targetPath) {
  if (!targetPath) return false;
  const resolved = resolveTilde(targetPath);

  // Don't allow hidden folders
  const baseName = path.basename(resolved);
  if (baseName.startsWith('.')) {
    return false;
  }

  for (const allowedRoot of config.ALLOWED_DIRECTORIES) {
    const resolvedRoot = resolveTilde(allowedRoot);
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
      const resolvedRoot = resolveTilde(rootPath);
      const displayRoot = formatDisplayPath(resolvedRoot);

      try {
        const stats = await fs.promises.stat(resolvedRoot);
        if (!stats.isDirectory()) continue;

        const entries = await fs.promises.readdir(resolvedRoot, { withFileTypes: true });
        const folders = [];

        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          let isDir = entry.isDirectory();
          if (!isDir && entry.isSymbolicLink()) {
            try {
              const targetStat = await fs.promises.stat(path.join(resolvedRoot, entry.name));
              isDir = targetStat.isDirectory();
            } catch (e) {}
          }

          if (isDir) {
            folders.push({
              name: entry.name,
              path: path.join(resolvedRoot, entry.name),
              displayPath: formatDisplayPath(path.join(resolvedRoot, entry.name))
            });
          }
        }

        folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

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
