import express from 'express';
import path from 'path';
import config, { resolveTilde } from '../config.js';
import { listSessions, createSession, terminateSession, getUniqueSessionName, hasSession } from '../tmuxManager.js';
import { isAllowedDirectory, formatDisplayPath } from './directories.js';
import { getWakelockStatus } from '../wakelock.js';
import { getRecentSessions } from '../recentSessions.js';
import { broadcastSessionsList } from '../sessionMonitor.js';

const router = express.Router();

// API: Get wakelock status
router.get('/wakelock', (req, res) => {
  res.json(getWakelockStatus());
});

// API: Get recent sessions history
router.get('/sessions/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 5;
    const recent = getRecentSessions(limit);
    res.json({ recent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: List active sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = listSessions();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Create a new session
router.post('/sessions', async (req, res) => {
  try {
    const { name, command, cwd } = req.body;
    const sessionCwd = cwd ? resolveTilde(cwd.trim()) : config.DEFAULT_CWD;

    if (!isAllowedDirectory(sessionCwd)) {
      return res.status(400).json({
        error: `Starting directory '${sessionCwd}' is not allowed. Must be a direct child directory within: ${config.ALLOWED_DIRECTORIES.map(formatDisplayPath).join(', ')} (1 level deep, non-hidden)`
      });
    }

    const sessionName = name && name.trim() ? name.trim() : path.basename(sessionCwd);
    const session = createSession({ name: sessionName, command, cwd: sessionCwd });
    broadcastSessionsList();
    res.json({ name: session.name, created: session.created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Kill a session
router.delete('/sessions/:name', async (req, res) => {
  try {
    const success = terminateSession(req.params.name);
    broadcastSessionsList();
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Suggest a unique session name for a directory path
router.get('/suggest-session-name', async (req, res) => {
  try {
    const targetCwd = req.query.cwd ? resolveTilde(req.query.cwd.toString()) : config.DEFAULT_CWD;
    const name = getUniqueSessionName(targetCwd);
    res.json({ name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
