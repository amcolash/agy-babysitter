import express from 'express';
import path from 'path';
import config, { resolveTilde } from '../config.js';
import { listSessions, createSession, terminateSession, getUniqueSessionName, hasSession } from '../tmuxManager.js';
import { isAllowedDirectory, formatDisplayPath } from './directories.js';
import { getWakelockStatus } from '../wakelock.js';
import { getRecentSessions } from '../recentSessions.js';
import { broadcastSessionsList } from '../sessionMonitor.js';
import { getSessionLabels, getSessionLabel, setSessionLabel, removeSessionLabel } from '../sessionLabels.js';

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
    res.json({ sessions, labels: getSessionLabels() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get all session labels
router.get('/sessions/labels', async (req, res) => {
  try {
    res.json({ labels: getSessionLabels() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set or clear label for a session
router.put('/sessions/:name/label', async (req, res) => {
  try {
    const { label } = req.body || {};
    const labels = setSessionLabel(req.params.name, label || '');
    res.json({
      success: true,
      name: req.params.name,
      label: getSessionLabel(req.params.name),
      labels
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:name/label', async (req, res) => {
  try {
    const { label } = req.body || {};
    const labels = setSessionLabel(req.params.name, label || '');
    res.json({
      success: true,
      name: req.params.name,
      label: getSessionLabel(req.params.name),
      labels
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete label for a session
router.delete('/sessions/:name/label', async (req, res) => {
  try {
    removeSessionLabel(req.params.name);
    res.json({ success: true, name: req.params.name, labels: getSessionLabels() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Create a new session
router.post('/sessions', async (req, res) => {
  try {
    const { name, command, cwd, label } = req.body;
    const sessionCwd = cwd ? resolveTilde(cwd.trim()) : config.DEFAULT_CWD;

    if (!isAllowedDirectory(sessionCwd)) {
      return res.status(400).json({
        error: `Starting directory '${sessionCwd}' is not allowed. Must be a direct child directory within: ${config.ALLOWED_DIRECTORIES.map(formatDisplayPath).join(', ')} (1 level deep, non-hidden)`
      });
    }

    const sessionName = name && name.trim() ? name.trim() : getUniqueSessionName(sessionCwd);
    const session = createSession({ name: sessionName, command, cwd: sessionCwd });
    if (label && typeof label === 'string') {
      setSessionLabel(session.name, label);
    }
    broadcastSessionsList();
    res.json({ name: session.name, created: session.created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Kill a session
router.delete('/sessions/:name', async (req, res) => {
  try {
    removeSessionLabel(req.params.name);
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
