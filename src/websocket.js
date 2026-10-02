import url from 'url';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import config from './config.js';
import { attachToTmuxSession } from './ptyManager.js';
import { touchWakelock } from './wakelock.js';

/**
 * Sets up WebSocket server for terminal streaming and control actions
 * @param {import('http').Server} server 
 * @returns {WebSocketServer}
 */
export function setupWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    touchWakelock(true);

    const parsedUrl = url.parse(req.url, true);
    const sessionName = parsedUrl.query.session || config.DEFAULT_SESSION;
    const cols = parseInt(parsedUrl.query.cols, 10) || 80;
    const rows = parseInt(parsedUrl.query.rows, 10) || 24;

    let ptyProcess = null;
    let isClosed = false;

    try {
      ptyProcess = await attachToTmuxSession({
        sessionName,
        cols,
        rows
      });

      // Stream PTY output to the browser WebSocket
      ptyProcess.onData((data) => {
        touchWakelock();
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          ws.close(1000, `PTY exited (code: ${exitCode}, signal: ${signal})`);
        }
      });
    } catch (err) {
      console.error('Failed to attach to tmux session:', err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[31m[Error attaching to tmux session '${sessionName}': ${err.message}]\x1b[0m\r\n`);
        ws.close(1011, err.message);
      }
      return;
    }

    // Handle messages/actions coming from the browser
    ws.on('message', (message) => {
      touchWakelock(true);
      if (!ptyProcess) return;

      const raw = message.toString();

      // Check if message is JSON-structured command
      if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
          const payload = JSON.parse(raw);
          if (payload.type === 'resize' && payload.cols && payload.rows) {
            try {
              ptyProcess.resize(Math.max(1, payload.cols), Math.max(1, payload.rows));
            } catch (e) {
              // Ignore resize errors when closing
            }
            return;
          } else if (payload.type === 'input') {
            ptyProcess.write(payload.data);
            return;
          } else if (payload.type === 'action') {
            if (payload.action === 'approve') ptyProcess.write('y\n');
            else if (payload.action === 'deny') ptyProcess.write('n\n');
            else if (payload.action === 'interrupt') ptyProcess.write('\x03');
            else if (payload.action === 'enter') ptyProcess.write('\r');
            return;
          }
        } catch (e) {
          // Fallback to raw writing
        }
      }

      ptyProcess.write(raw);
    });

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch (e) {}
        ptyProcess = null;
      }
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  return wss;
}

/**
 * Watch target directory for UI changes and notify connected clients to reload
 * @param {WebSocketServer} wss 
 * @param {string} targetDir 
 */
export function setupAssetWatcher(wss, targetDir) {
  let reloadDebounceTimer = null;

  try {
    if (fs.existsSync(targetDir)) {
      fs.watch(targetDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (filename.startsWith('.') || filename.endsWith('~') || filename.includes('.tmp')) return;

        clearTimeout(reloadDebounceTimer);
        reloadDebounceTimer = setTimeout(() => {
          console.log(`[Auto-Refresh] Detected UI change in ${filename}, broadcasting reload...`);
          const reloadMsg = JSON.stringify({ type: 'reload' });
          for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(reloadMsg);
            }
          }
        }, 150);
      });
    }
  } catch (err) {
    console.warn('[Auto-Refresh] Failed to watch directory for changes:', err.message);
  }
}
