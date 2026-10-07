import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { listActiveSessions, createOrGetSession, terminateSession, getSession } from './sessionManager.js';

export function getIpcSocketPath() {
  const uid = process.getuid ? process.getuid() : 1000;
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  if (fs.existsSync(runtimeDir)) {
    return path.join(runtimeDir, 'agy-babysitter.sock');
  }
  return path.join(os.tmpdir(), `agy-babysitter-${uid}.sock`);
}

/**
 * Starts the UNIX domain socket server for local native terminal (CLI) attachments
 * @returns {net.Server}
 */
export function startIpcServer() {
  const socketPath = getIpcSocketPath();

  // Clean up stale socket file if it exists
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch (e) {}

  const server = net.createServer((socket) => {
    let attachedSession = null;
    let clientObj = null;
    let isAttached = false;
    let handshakeBuffer = '';

    const onData = (chunk) => {
      if (!isAttached) {
        handshakeBuffer += chunk.toString();
        const newlineIdx = handshakeBuffer.indexOf('\n');
        if (newlineIdx === -1) return;

        const line = handshakeBuffer.slice(0, newlineIdx).trim();
        const rest = handshakeBuffer.slice(newlineIdx + 1);

        try {
          const req = JSON.parse(line);

          if (req.action === 'list') {
            socket.write(JSON.stringify({ sessions: listActiveSessions() }) + '\n');
            socket.end();
            return;
          }

          if (req.action === 'kill') {
            const ok = terminateSession(req.session);
            socket.write(JSON.stringify({ ok }) + '\n');
            socket.end();
            return;
          }

          if (req.action === 'create' || req.action === 'attach') {
            const session = createOrGetSession({
              name: req.session,
              cwd: req.cwd,
              command: req.command,
              cols: req.cols || 120,
              rows: req.rows || 35
            });

            if (req.action === 'create' && !req.attach) {
              socket.write(JSON.stringify({ ok: true, name: session.name }) + '\n');
              socket.end();
              return;
            }

            // Attached streaming mode
            attachedSession = session;
            isAttached = true;

            clientObj = {
              type: 'ipc',
              send: (data) => {
                try {
                  socket.write(data);
                } catch (e) {}
              },
              close: () => {
                try {
                  socket.end();
                } catch (e) {}
              }
            };

            session.addClient(clientObj);

            // Send existing terminal scrollback history
            const history = session.getHistory();
            if (history) {
              socket.write(history);
            }

            // If there were extra bytes after handshake line, send to PTY
            if (rest.length > 0) {
              session.write(rest);
            }
          }
        } catch (err) {
          socket.write(JSON.stringify({ error: err.message }) + '\n');
          socket.end();
        }
        return;
      }

      // If already attached, check for escape sequences or write straight to PTY
      const str = chunk.toString();
      if (str.startsWith('__AGYH_RESIZE__:')) {
        try {
          const parts = str.slice(16).trim().split(',');
          const cols = parseInt(parts[0], 10);
          const rows = parseInt(parts[1], 10);
          if (attachedSession && cols && rows) {
            attachedSession.resize(cols, rows);
          }
        } catch (e) {}
        return;
      }

      if (attachedSession) {
        attachedSession.write(chunk);
      }
    };

    socket.on('data', onData);

    const cleanup = () => {
      if (attachedSession && clientObj) {
        attachedSession.removeClient(clientObj);
        attachedSession = null;
        clientObj = null;
      }
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch (e) {}
    console.log(`[IPC] Native terminal socket listening at ${socketPath}`);
  });

  return server;
}

export default {
  startIpcServer,
  getIpcSocketPath
};
