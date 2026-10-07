#!/usr/bin/env node

import path from 'path';
import readline from 'readline';
import { execSync, spawn } from 'child_process';
import config, { resolveTilde } from './config.js';
import { listSessions, hasSession, createSession, terminateSession, sanitizeSessionName, applyTmuxGlobalOptions } from './tmuxManager.js';

// Ensure normal interactive scheduling for the CLI process
try {
  execSync(`chrt -o -p 0 ${process.pid} 2>/dev/null || true`);
} catch (e) {}

async function ensureServerRunning() {
  let isSystemdActive = false;
  try {
    isSystemdActive =
      execSync('systemctl --user is-active agy-babysitter.service 2>/dev/null', {
        encoding: 'utf8'
      }).trim() === 'active';
  } catch (e) {}

  if (!isSystemdActive) {
    process.stdout.write('\x1b[38;2;81;175;239m➜\x1b[0m Starting agy-babysitter service...');
    try {
      execSync('systemctl --user start agy-babysitter.service 2>/dev/null', { stdio: 'ignore' });
    } catch (e) {}
    process.stdout.write(' \x1b[38;2;152;190;101mactive!\x1b[0m\n');
  }
}

function attachNativeTmux(sessionName, cwd, command) {
  const name = sanitizeSessionName(sessionName);
  if (!hasSession(name)) {
    createSession({ name, cwd: cwd || process.cwd(), command });
  } else {
    applyTmuxGlobalOptions(name);
  }

  // Spawn tmux attach directly with inherited stdio for 100% native terminal performance
  const child = spawn('tmux', ['attach-session', '-t', name], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      AGY_SESSION_NAME: name,
      ZELLIJ_SESSION_NAME: name
    }
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

async function handleInteractiveSelect() {
  await ensureServerRunning();
  const sessions = listSessions();
  const currentFolder = path.basename(process.cwd());

  // If a session matching current directory exists, attach directly
  const match = sessions.find((s) => s.name === currentFolder);
  if (match) {
    console.log(`Attaching to existing session '\x1b[36m${match.name}\x1b[0m'... (Press \x1b[33mCtrl+b d\x1b[0m to detach)`);
    attachNativeTmux(match.name, match.cwd);
    return;
  }

  if (sessions.length === 0) {
    console.log(`Creating and attaching to session '\x1b[36m${currentFolder}\x1b[0m'... (Press \x1b[33mCtrl+b d\x1b[0m to detach)`);
    attachNativeTmux(currentFolder, process.cwd());
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
      attachNativeTmux(currentFolder, process.cwd());
      return;
    }

    const num = parseInt(choice, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      const target = sessions[num - 1];
      attachNativeTmux(target.name, target.cwd);
      return;
    }

    // Check if typed name directly
    const byName = sessions.find((s) => s.name === choice);
    if (byName) {
      attachNativeTmux(byName.name, byName.cwd);
    } else {
      attachNativeTmux(choice, process.cwd());
    }
  });
}

// CLI Command Router
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'attach') {
  const sessionArg = args[1];
  if (sessionArg) {
    ensureServerRunning().then(() => {
      attachNativeTmux(sessionArg);
    });
  } else {
    handleInteractiveSelect();
  }
} else if (command === 'list' || command === 'ls') {
  ensureServerRunning().then(() => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log('No active sessions.');
    } else {
      console.log('\x1b[1mActive Sessions:\x1b[0m');
      sessions.forEach((s) => {
        console.log(`  - \x1b[36m${s.name}\x1b[0m (cwd: ${s.cwd}, attached: ${s.attached})`);
      });
    }
  });
} else if (command === 'kill') {
  const sessionArg = args[1];
  if (!sessionArg) {
    console.error('Usage: agyh kill <session-name>');
    process.exit(1);
  }
  ensureServerRunning().then(() => {
    const ok = terminateSession(sessionArg);
    console.log(ok ? `✓ Terminated session '${sessionArg}'` : `Session '${sessionArg}' not found`);
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
\x1b[1magyh\x1b[0m - Native CLI helper for agy-babysitter (tmux backend)

\x1b[1mUsage:\x1b[0m
  agyh                  Select or attach to a session for current folder
  agyh attach <name>    Attach to a specific session
  agyh list             List all active background sessions
  agyh kill <name>      Terminate a background session
  agyh web              Print Web UI URL
  agyh status           Show systemd service status
  agyh logs             View live daemon logs

\x1b[1mShortcut:\x1b[0m
  Press \x1b[33mCtrl+b d\x1b[0m inside any session to detach cleanly without closing it.
`);
}
