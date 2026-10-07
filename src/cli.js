#!/usr/bin/env node

import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { execSync, spawn } from 'child_process';
import config, { resolveTilde } from './config.js';
import { getIpcSocketPath } from './ipcServer.js';

// Ensure normal interactive scheduling for the CLI process
try {
  execSync(`chrt -o -p 0 ${process.pid} 2>/dev/null || true`);
} catch (e) {}

function isServerRunning() {
  try {
    const socketPath = getIpcSocketPath();
    return fs.existsSync(socketPath);
  } catch (e) {
    return false;
  }
}

async function ensureServerRunning() {
  let isSystemdActive = false;
  try {
    isSystemdActive =
      execSync('systemctl --user is-active agy-babysitter.service 2>/dev/null', {
        encoding: 'utf8'
      }).trim() === 'active';
  } catch (e) {}

  if (isSystemdActive && isServerRunning()) {
    return true;
  }

  process.stdout.write('\x1b[38;2;81;175;239m➜\x1b[0m Starting agy-babysitter service...');
  try {
    execSync('systemctl --user start agy-babysitter.service 2>/dev/null', { stdio: 'ignore' });
  } catch (e) {}

  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (isServerRunning()) {
      process.stdout.write(' \x1b[38;2;152;190;101mactive!\x1b[0m\n');
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  process.stdout.write(' \x1b[38;2;236;190;123mready\x1b[0m\n');
  return true;
}

function sendIpcRequest(payload) {
  return new Promise((resolve, reject) => {
    const socketPath = getIpcSocketPath();
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify(payload) + '\n');
    });

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes('\n')) {
        try {
          const res = JSON.parse(buffer.trim());
          socket.end();
          resolve(res);
        } catch (e) {
          socket.end();
          resolve({ raw: buffer });
        }
      }
    });

    socket.on('error', reject);
  });
}

function attachIpcSession(sessionName, cwd, command) {
  const socketPath = getIpcSocketPath();
  const socket = net.createConnection(socketPath, () => {
    const cols = process.stdout.columns || 120;
    const rows = process.stdout.rows || 35;

    // Send initial handshake
    socket.write(
      JSON.stringify({
        action: 'attach',
        session: sessionName,
        cwd: cwd ? resolveTilde(cwd) : process.cwd(),
        command: command || 'agy',
        cols,
        rows
      }) + '\n'
    );

    // Put local terminal into raw streaming mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf-8');

      process.stdin.on('data', (key) => {
        // Ctrl+] to detach cleanly
        if (key === '\x1d') {
          process.stdout.write('\r\n\x1b[33m[Detached from session]\x1b[0m\r\n');
          cleanupAndExit(0);
          return;
        }
        socket.write(key);
      });
    }

    // Forward socket output straight to native terminal stdout with 0 latency
    socket.on('data', (chunk) => {
      process.stdout.write(chunk);
    });

    // Handle terminal resize events
    const onResize = () => {
      const newCols = process.stdout.columns;
      const newRows = process.stdout.rows;
      if (newCols && newRows) {
        socket.write(`__AGYH_RESIZE__:${newCols},${newRows}`);
      }
    };
    process.stdout.on('resize', onResize);
  });

  const cleanupAndExit = (code = 0) => {
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      socket.end();
    } catch (e) {}
    process.exit(code);
  };

  socket.on('close', () => {
    cleanupAndExit(0);
  });

  socket.on('error', (err) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    console.error(`\x1b[31mError connecting to session:\x1b[0m ${err.message}`);
    process.exit(1);
  });
}

async function handleInteractiveSelect() {
  await ensureServerRunning();
  try {
    const res = await sendIpcRequest({ action: 'list' });
    const sessions = res.sessions || [];

    const currentFolder = path.basename(process.cwd());

    // If a session matching current directory exists, attach directly
    const match = sessions.find((s) => s.name === currentFolder);
    if (match) {
      console.log(`Attaching to existing session '${match.name}'... (Press Ctrl+] to detach)`);
      attachIpcSession(match.name, match.cwd);
      return;
    }

    if (sessions.length === 0) {
      console.log(`Creating and attaching to session '${currentFolder}'... (Press Ctrl+] to detach)`);
      attachIpcSession(currentFolder, process.cwd());
      return;
    }

    console.log('\n\x1b[1mActive agy-babysitter Sessions:\x1b[0m');
    sessions.forEach((s, idx) => {
      console.log(`  \x1b[36m${idx + 1})\x1b[0m \x1b[1m${s.name}\x1b[0m (${s.cwd})`);
    });
    console.log(`  \x1b[32m+)\x1b[0m Create new session for current directory (\x1b[1m${currentFolder}\x1b[0m)\n`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Select a session number or press ENTER for current directory: ', (ans) => {
      rl.close();
      const choice = ans.trim();
      if (!choice || choice === '+') {
        attachIpcSession(currentFolder, process.cwd());
        return;
      }

      const num = parseInt(choice, 10);
      if (!isNaN(num) && num >= 1 && num <= sessions.length) {
        const target = sessions[num - 1];
        attachIpcSession(target.name, target.cwd);
        return;
      }

      // Check if typed name directly
      const byName = sessions.find((s) => s.name === choice);
      if (byName) {
        attachIpcSession(byName.name, byName.cwd);
      } else {
        attachIpcSession(choice, process.cwd());
      }
    });
  } catch (err) {
    console.error('Failed to communicate with daemon:', err.message);
  }
}

// CLI Command Router
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'attach') {
  const sessionArg = args[1];
  if (sessionArg) {
    ensureServerRunning().then(() => {
      attachIpcSession(sessionArg);
    });
  } else {
    handleInteractiveSelect();
  }
} else if (command === 'list' || command === 'ls') {
  ensureServerRunning().then(async () => {
    const res = await sendIpcRequest({ action: 'list' });
    const sessions = res.sessions || [];
    if (sessions.length === 0) {
      console.log('No active sessions.');
    } else {
      console.log('\x1b[1mActive Sessions:\x1b[0m');
      sessions.forEach((s) => {
        console.log(`  - \x1b[36m${s.name}\x1b[0m (cwd: ${s.cwd}, clients: ${s.clientCount})`);
      });
    }
  });
} else if (command === 'kill') {
  const sessionArg = args[1];
  if (!sessionArg) {
    console.error('Usage: agyh kill <session-name>');
    process.exit(1);
  }
  ensureServerRunning().then(async () => {
    const res = await sendIpcRequest({ action: 'kill', session: sessionArg });
    console.log(res.ok ? `✓ Terminated session '${sessionArg}'` : `Session '${sessionArg}' not found`);
  });
} else if (command === 'status') {
  try {
    execSync('systemctl --user status agy-babysitter.service', { stdio: 'inherit' });
  } catch (e) {}
} else if (command === 'logs') {
  try {
    execSync('journalctl --user -u agy-babysitter -f', { stdio: 'inherit' });
  } catch (e) {}
} else if (command === 'web') {
  console.log(`agy-babysitter web dashboard: http://${config.HOST || '0.0.0.0'}:${config.PORT || 8080}`);
} else {
  console.log(`
\x1b[1magyh\x1b[0m - Native CLI helper for agy-babysitter

\x1b[1mUsage:\x1b[0m
  agyh                  Select or attach to a session for the current folder
  agyh attach <name>    Attach to a specific session
  agyh list             List all active background sessions
  agyh kill <name>      Terminate a background session
  agyh web              Print Web UI URL
  agyh status           Show systemd service status
  agyh logs             View live daemon logs

\x1b[1mShortcut:\x1b[0m
  Press \x1b[33mCtrl+]\x1b[0m inside any session to detach without closing it.
`);
}
