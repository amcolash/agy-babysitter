import url from 'url';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import config from './config.js';
import { attachPtySession, listSessions, hasSession } from './tmuxManager.js';
import { markTurnStarted, clearNotification, getAllNotificationStates, broadcastSessionsList } from './sessionMonitor.js';

/**
 * Sets up WebSocket server for terminal streaming and control actions
 * @param {import('http').Server} server 
 * @returns {WebSocketServer}
 */
export function setupWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const parsedUrl = url.parse(req.url, true);
    const initialSession = parsedUrl.query.session ? parsedUrl.query.session.trim() : null;
    let cols = parseInt(parsedUrl.query.cols, 10) || 100;
    let rows = parseInt(parsedUrl.query.rows, 10) || 30;

    let ptyProcess = null;
    let currentAttachedSession = null;
    let isClosed = false;

    function cleanupPty() {
      if (ptyProcess) {
        const proc = ptyProcess;
        ptyProcess = null;
        try {
          proc.kill();
        } catch (e) {}
      }
      currentAttachedSession = null;
      ws.sessionName = null;
    }

    function attachToSession(sessionName, newCols, newRows) {
      if (newCols) cols = newCols;
      if (newRows) rows = newRows;

      if (!sessionName) {
        cleanupPty();
        return false;
      }

      if (!hasSession(sessionName)) {
        cleanupPty();
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'session_attach_error',
            session: sessionName,
            error: `Session '${sessionName}' not found`
          }));
        }
        return false;
      }

      // If already attached to this session, simply resize if requested
      if (ptyProcess && currentAttachedSession === sessionName) {
        try {
          ptyProcess.resize(Math.max(20, cols), Math.max(5, rows));
        } catch (e) {}
        return true;
      }

      cleanupPty();

      try {
        const proc = attachPtySession({
          sessionName,
          cols,
          rows
        });

        ptyProcess = proc;
        currentAttachedSession = sessionName;
        ws.sessionName = sessionName;

        proc.onData((data) => {
          if (!isClosed && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        proc.onExit(({ exitCode }) => {
          if (ptyProcess === proc) {
            ptyProcess = null;
            currentAttachedSession = null;
          }
          if (!isClosed && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'session_detached',
              session: sessionName,
              exitCode
            }));
          }
          setTimeout(() => {
            broadcastSessionsList();
          }, 50);
        });

        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'session_attached',
            session: sessionName
          }));
        }

        return true;
      } catch (err) {
        console.error(`Failed to attach to tmux session '${sessionName}':`, err.message);
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'session_attach_error',
            session: sessionName,
            error: err.message
          }));
        }
        return false;
      }
    }

    // Attach to initial session if requested and exists
    if (initialSession && hasSession(initialSession)) {
      attachToSession(initialSession, cols, rows);
    }

    // Always send active sessions list and notification states to newly connected client
    try {
      const currentSessions = listSessions();
      ws.send(JSON.stringify({ type: 'sessions_changed', sessions: currentSessions }));

      const initialStates = getAllNotificationStates();
      if (initialStates && Object.keys(initialStates).length > 0) {
        ws.send(JSON.stringify({ type: 'session_notifications_sync', states: initialStates }));
      }
    } catch (e) {}

    // Handle messages/actions coming from the browser
    ws.on('message', (message) => {
      const raw = message.toString();

      // Check if message is JSON-structured command
      if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
          const payload = JSON.parse(raw);
          if (payload.type === 'attach' && payload.session) {
            attachToSession(payload.session, payload.cols, payload.rows);
            return;
          } else if (payload.type === 'detach') {
            cleanupPty();
            return;
          } else if (payload.type === 'resize' && payload.cols && payload.rows) {
            cols = Math.max(20, payload.cols);
            rows = Math.max(5, payload.rows);
            if (ptyProcess) {
              try {
                ptyProcess.resize(cols, rows);
              } catch (e) {}
            }
            return;
          } else if (payload.type === 'input' && payload.data !== undefined) {
            if (ptyProcess) {
              ptyProcess.write(payload.data);
            }
            return;
          } else if (payload.type === 'action') {
            const activeSes = payload.session || currentAttachedSession;
            if (activeSes) {
              markTurnStarted(activeSes);
            }
            if (ptyProcess) {
              if (payload.action === 'approve') ptyProcess.write('y\n');
              else if (payload.action === 'deny') ptyProcess.write('n\n');
              else if (payload.action === 'interrupt') ptyProcess.write('\x03');
              else if (payload.action === 'enter') ptyProcess.write('\r');
            }
            return;
          } else if (payload.type === 'clear_notification') {
            clearNotification(payload.session || currentAttachedSession);
            return;
          }
        } catch (e) {
          // Fallback to raw writing
        }
      }

      if (ptyProcess) {
        ptyProcess.write(raw);
      }
    });

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      cleanupPty();
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

export default {
  setupWebSocketServer,
  setupAssetWatcher,
  broadcastServerRestart
};
