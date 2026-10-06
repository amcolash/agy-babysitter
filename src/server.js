import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config.js';
import directoriesRouter, { formatDisplayPath } from './routes/directories.js';
import sessionsRouter from './routes/sessions.js';
import { setupWebSocketServer, setupAssetWatcher, broadcastServerRestart } from './websocket.js';
import { touchWakelock } from './wakelock.js';

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
app.use(express.json());
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
}
if (fs.existsSync(publicDir) && publicDir !== clientDir) {
  app.use(express.static(publicDir));
}

// API Routes
app.use('/api', directoriesRouter);
app.use('/api', sessionsRouter);

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

// WebSocket & Live-reload Asset Watcher
const wss = setupWebSocketServer(server);
setupAssetWatcher(wss, clientDir);

server.listen(config.PORT, config.HOST, () => {
  touchWakelock();
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
