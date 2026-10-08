import express from 'express';
import { handleLifecycleHookEvent, broadcastQuota } from '../sessionMonitor.js';
import { saveQuota } from '../quotaManager.js';

const router = express.Router();

/**
 * Endpoint called by the Antigravity global lifecycle hook script (hooks/notify.cjs)
 */
router.post('/hook/notify', (req, res) => {
  try {
    const { event, session, conversationId, toolCall, payload } = req.body || {};
    handleLifecycleHookEvent({ event, session, conversationId, toolCall });
    if (req.body?.quota || payload?.quota) {
      const saved = saveQuota(req.body.quota ? req.body : payload);
      if (saved) broadcastQuota(saved);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
