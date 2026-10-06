import url from 'url';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import config from './config.js';
import { attachToSession } from './ptyManager.js';
import { touchWakelock } from './wakelock.js';
import { markTurnStarted, clearNotification, getAllNotificationStates, feedSessionStream, onSessionDisconnected } from './sessionMonitor.js';

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
      ptyProcess = await attachToSession({
        sessionName,
        cols,
        rows
      });

      // Stream PTY output to the browser WebSocket immediately
      ptyProcess.onData((data) => {
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
        touchWakelock();
        queueMicrotask(() => {
          feedSessionStream(sessionName, data);
        });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          const reason = `PTY exited (code: ${exitCode}, signal: ${signal})`.slice(0, 120);
          ws.close(1000, reason);
        }
      });
    } catch (err) {
      console.error('Failed to attach to session:', err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[31m[Error attaching to session '${sessionName}': ${err.message}]\x1b[0m\r\n`);
        const closeReason = (err.message || 'Error attaching to session').slice(0, 120);
        ws.close(1011, closeReason);
      }
      return;
    }

    ws.sessionName = sessionName;

    // Send initial notification states across all sessions to newly connected client
    try {
      const initialStates = getAllNotificationStates();
      if (initialStates && Object.keys(initialStates).length > 0) {
        ws.send(JSON.stringify({ type: 'session_notifications_sync', states: initialStates }));
      }
    } catch (e) {}

    // Handle messages/actions coming from the browser
    ws.on('message', (message) => {
      touchWakelock();
      if (!ptyProcess) return;

      const raw = message.toString();

      // Check if message is JSON-structured command
      if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
          const payload = JSON.parse(raw);
          if (payload.type === 'resize' && payload.cols && payload.rows) {
            try {
              const newCols = Math.max(1, payload.cols);
              const newRows = Math.max(1, payload.rows);
              if (ptyProcess.cols !== newCols || ptyProcess.rows !== newRows) {
                ptyProcess.resize(newCols, newRows);
                // Notify other connected clients for this session about the resize reflow
                const notice = JSON.stringify({ type: 'session_resized', session: sessionName });
                wss.clients.forEach((client) => {
                  if (client !== ws && client.readyState === WebSocket.OPEN && client.sessionName === sessionName) {
                    client.send(notice);
                  }
                });
              }
            } catch (e) {
              // Ignore resize errors when closing
            }
            return;
          } else if (payload.type === 'input') {
            ptyProcess.write(payload.data);
            return;
          } else if (payload.type === 'action') {
            markTurnStarted(sessionName);
            if (payload.action === 'approve') ptyProcess.write('y\n');
            else if (payload.action === 'deny') ptyProcess.write('n\n');
            else if (payload.action === 'interrupt') ptyProcess.write('\x03');
            else if (payload.action === 'enter') ptyProcess.write('\r');
            return;
          } else if (payload.type === 'clear_notification') {
            clearNotification(payload.session || sessionName);
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
      onSessionDisconnected(sessionName);
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

/**
 * Broadcasts an upgrade/restarting notification to all connected clients
 * @param {WebSocketServer} wss 
 * @param {string} [message] 
 */
export function broadcastServerRestart(wss, message = 'Server is restarting with updates...') {
  const payload = JSON.stringify({ type: 'restarting', message });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (e) {}
    }
  }
}
