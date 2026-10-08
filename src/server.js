import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config.js';
import directoriesRouter, { formatDisplayPath } from './routes/directories.js';
import sessionsRouter from './routes/sessions.js';
import hooksRouter from './routes/hooks.js';
import quotaRouter from './routes/quota.js';
import { setupWebSocketServer, setupAssetWatcher, broadcastServerRestart } from './websocket.js';
import { stopAllWakelocks } from './wakelock.js';
import { initSessionMonitor, stopSessionMonitor } from './sessionMonitor.js';

// Clean up any stale or duplicate wakelocks from previous runs
stopAllWakelocks();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Resolve client build directory (whether running from src/ or dist/server/)
function findClientDir() {
  const candidates = [
    path.resolve(__dirname, '..', 'client'),         // from dist/server/ -> dist/client
    path.resolve(__dirname, '..', 'dist', 'client'), // from src/ -> dist/client
    path.resolve(process.cwd(), 'dist', 'client'),
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return path.resolve(process.cwd(), 'public');
}

const clientDir = findClientDir();
const publicDir = path.resolve(process.cwd(), 'public');

// Middlewares & static files
app.use(express.json({ limit: '1mb' }));
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}
if (fs.existsSync(publicDir) && publicDir !== clientDir) {
  app.use(express.static(publicDir));
}

// API Routes
app.use('/api', directoriesRouter);
app.use('/api', sessionsRouter);
app.use('/api', hooksRouter);
app.use('/api', quotaRouter);

// SPA fallback route
app.get('{*path}', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  const distIndex = path.join(clientDir, 'index.html');
  const rootIndex = path.resolve(process.cwd(), 'index.html');
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex);
  } else if (fs.existsSync(rootIndex)) {
    res.sendFile(rootIndex);
  } else {
    res.status(404).send('Not Found');
  }
});

// WebSocket, Live-reload Asset Watcher, and Session Background Monitor
const wss = setupWebSocketServer(server);
setupAssetWatcher(wss, clientDir);
initSessionMonitor(wss);

server.listen(config.PORT, config.HOST, () => {
  console.log(`agy babysitter running at http://${config.HOST}:${config.PORT}`);
  console.log(`Default session: ${config.DEFAULT_SESSION}, default directory: ${config.DEFAULT_CWD}`);
  console.log(`Allowed directories: ${config.ALLOWED_DIRECTORIES.map(formatDisplayPath).join(', ')}`);
});

// Graceful shutdown notification
let isShuttingDown = false;
function handleGracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}, notifying connected clients of update...`);
  stopSessionMonitor();
  stopAllWakelocks();
  broadcastServerRestart(wss);
  setTimeout(() => {
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 400);
  }, 100);
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

export { app, server, wss };
