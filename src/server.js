import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from './config.js';
import directoriesRouter, { formatDisplayPath } from './routes/directories.js';
import sessionsRouter from './routes/sessions.js';
import { setupWebSocketServer, setupAssetWatcher } from './websocket.js';
import { touchWakelock } from './wakelock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const distDir = path.join(__dirname, '..', 'dist');
const publicDir = path.join(__dirname, '..', 'public');

// Middlewares & static files
app.use(express.json());
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}
app.use(express.static(publicDir));

// API Routes
app.use('/api', directoriesRouter);
app.use('/api', sessionsRouter);

// SPA fallback route
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  const distIndex = path.join(distDir, 'index.html');
  const rootIndex = path.join(__dirname, '..', 'index.html');
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
const watchTarget = fs.existsSync(distDir) ? distDir : publicDir;
setupAssetWatcher(wss, watchTarget);

server.listen(config.PORT, config.HOST, () => {
  touchWakelock();
  console.log(`agy babysitter running at http://${config.HOST}:${config.PORT}`);
  console.log(`Default session: ${config.DEFAULT_SESSION}, default directory: ${config.DEFAULT_CWD}`);
  console.log(`Allowed directories: ${config.ALLOWED_DIRECTORIES.map(formatDisplayPath).join(', ')}`);
});

export { app, server, wss };
