import express from 'express';
import { getQuota, saveQuota } from '../quotaManager.js';
import { broadcastQuota } from '../sessionMonitor.js';

const router = express.Router();

// GET /api/quota: Retrieve latest quota information
router.get('/quota', (req, res) => {
  try {
    const quota = getQuota();
    res.json({ quota });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quota: Update latest quota from statusline or hook
router.post('/quota', (req, res) => {
  try {
    const saved = saveQuota(req.body);
    if (saved) {
      broadcastQuota(saved);
    }
    res.json({ ok: true, quota: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
