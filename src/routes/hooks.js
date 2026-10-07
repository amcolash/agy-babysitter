import express from 'express';
import { handleLifecycleHookEvent } from '../sessionMonitor.js';

const router = express.Router();

/**
 * Endpoint called by the Antigravity global lifecycle hook script (hooks/notify.cjs)
 */
router.post('/hook/notify', (req, res) => {
  try {
    const { event, session, conversationId, toolCall } = req.body || {};
    handleLifecycleHookEvent({ event, session, conversationId, toolCall });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
