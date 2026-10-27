import express from 'express';
import os from 'os';
import config from '../config.js';

const router = express.Router();

// 1x1 transparent PNG buffer for rapid image ping / Mixed Content probe
const TRANSPARENT_1PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function setDiscoveryHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
}

/**
 * GET /api/discovery
 * Lightweight JSON response indicating this server is agy-babysitter
 */
router.get('/discovery', (req, res) => {
  setDiscoveryHeaders(res);
  res.json({
    app: 'agy-babysitter',
    version: '1.0.0',
    hostname: os.hostname(),
    port: config.PORT,
    platform: process.platform,
    time: Date.now()
  });
});

/**
 * GET /api/discovery.png
 * 1x1 transparent image ping for image probe scanners
 */
router.get('/discovery.png', (req, res) => {
  setDiscoveryHeaders(res);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', TRANSPARENT_1PX_PNG.length);
  res.end(TRANSPARENT_1PX_PNG);
});

export default router;
