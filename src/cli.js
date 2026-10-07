#!/usr/bin/env node

import { spawn, spawnSync, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import config, { resolveTilde, formatDisplayPath } from './config.js';
import {
  listSessions,
  createSession,
  hasSession,
  sanitizeSessionName,
  applyTmuxGlobalOptions
} from './tmuxManager.js';

// Ensure normal interactive scheduling for the CLI process
try {
  execSync(`chrt -o -p 0 ${process.pid} 2>/dev/null || true`);
} catch (e) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distServerScript = path.join(rootDir, 'dist', 'server', 'server.js');
const srcServerScript = path.join(__dirname, 'server.js');
const serverScript = fs.existsSync(distServerScript) ? distServerScript : srcServerScript;

function isServerRunning() {
  try {
    const stdout = execSync('pgrep -f "node.*server.js"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return Boolean(stdout.trim());
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

  if (isSystemdActive) {
    return true;
  }

  process.stdout.write('\x1b[38;2;81;175;239m➜\x1b[0m Starting agy-babysitter service...');
  try {
    execSync('systemctl --user start agy-babysitter.service 2>/dev/null', { stdio: 'ignore' });
  } catch (e) {
    if (!isServerRunning()) {
      const proc = spawn(process.execPath, [serverScript], {
        detached: true,
        stdio: 'ignore',
        cwd: rootDir
      });
      proc.unref();
    }
  }

  // Poll for up to 5 seconds until active
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const active =
        execSync('systemctl --user is-active agy-babysitter.service 2>/dev/null', {
          encoding: 'utf8'
        }).trim() === 'active';
      if (active) {
        process.stdout.write(' \x1b[38;2;152;190;101mactive!\x1b[0m\n');
        return true;
      }
    } catch (e) {}
    if (isServerRunning()) {
      process.stdout.write(' \x1b[38;2;152;190;101mrunning!\x1b[0m\n');
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  process.stdout.write(' \x1b[38;2;236;190;123mready\x1b[0m\n');
  return true;
}

function attachSession(sessionName, cwd, command) {
  const name = sanitizeSessionName(sessionName);
  const targetCwd = resolveTilde(cwd || config.DEFAULT_CWD);

  if (!fs.existsSync(targetCwd)) {
    fs.mkdirSync(targetCwd, { recursive: true });
  }

  if (!hasSession(name)) {
    createSession({ name, cwd: targetCwd, command });
  } else {
    applyTmuxGlobalOptions(name);
  }

  // Restore cursor visibility and pause Node's stdin reading before passing stdio to tmux
  process.stdout.write('\x1b[?25h');
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch (e) {}
  }
  process.stdin.pause();

  // Attach directly to tmux synchronously with inherited stdio for 100% native terminal speed
  const res = spawnSync('tmux', ['attach-session', '-t', name], {
    cwd: targetCwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      AGY_SESSION_NAME: name
    }
  });

  process.exit(res.status ?? (res.signal ? 1 : 0));
}

function question(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function promptCreateSession() {
  process.stdout.write('\n\x1b[1m\x1b[38;2;152;190;101mCreate New agy Session\x1b[0m\n');
  process.stdout.write('\x1b[38;2;91;98;104m' + '─'.repeat(40) + '\x1b[0m\n');

  const defaultDir = process.cwd();
  const rawPath = await question(
    `\x1b[38;2;81;175;239mDirectory path\x1b[0m [\x1b[38;2;91;98;104m${formatDisplayPath(defaultDir)}\x1b[0m]: `
  );
  const sessionCwd = rawPath ? resolveTilde(rawPath) : defaultDir;

  const defaultName = sanitizeSessionName(path.basename(sessionCwd));
  const rawName = await question(
    `\x1b[38;2;81;175;239mSession name\x1b[0m [\x1b[38;2;91;98;104m${defaultName}\x1b[0m]: `
  );
  const sessionName = rawName ? sanitizeSessionName(rawName) : defaultName;

  process.stdout.write(
    `\n\x1b[38;2;81;175;239m➜\x1b[0m Launching session '\x1b[1m${sessionName}\x1b[0m' in \x1b[38;2;91;98;104m${formatDisplayPath(sessionCwd)}\x1b[0m...\n\n`
  );

  createSession({ name: sessionName, cwd: sessionCwd });
  attachSession(sessionName, sessionCwd);
}

function stopService() {
  process.stdout.write('\n\x1b[38;2;255;108;107mStopping agy-babysitter service...\x1b[0m\n');
  try {
    execSync('systemctl --user stop agy-babysitter.service 2>/dev/null');
  } catch (e) {}
  try {
    execSync('pkill -f "node.*server.js" 2>/dev/null');
  } catch (e) {}
  process.stdout.write('\x1b[38;2;152;190;101m✓ agy-babysitter service stopped.\x1b[0m\n\n');
}

function restartService() {
  process.stdout.write('\n\x1b[38;2;236;190;123mRestarting agy-babysitter service...\x1b[0m\n');
  try {
    execSync('systemctl --user restart agy-babysitter.service', { stdio: 'inherit' });
    process.stdout.write('\x1b[38;2;152;190;101m✓ Service restarted successfully.\x1b[0m\n\n');
  } catch (e) {
    console.error('Failed to restart service:', e.message);
  }
}

function streamLogs() {
  process.stdout.write('\x1b[?25h');
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch (e) {}
  }
  process.stdin.pause();

  const res = spawnSync('journalctl', ['--user', '-u', 'agy-babysitter', '-f', '-n', '50'], {
    stdio: 'inherit'
  });
  process.exit(res.status ?? (res.signal ? 1 : 0));
}

async function showInteractiveMenu() {
  await ensureServerRunning();
  const sessions = listSessions();

  const items = [];
  sessions.forEach((s) => {
    items.push({
      type: 'session',
      name: s.name,
      path: s.cwd || config.DEFAULT_CWD,
      badge: s.name === config.DEFAULT_SESSION ? '(Default)' : ''
    });
  });

  items.push({ type: 'create', key: '+', label: '+ Start new session...' });
  items.push({ type: 'restart', key: 'r', label: '↻ Restart service' });
  items.push({ type: 'stop', key: 's', label: '■ Stop service' });
  items.push({ type: 'logs', key: 'l', label: '▤ Follow logs' });
  items.push({ type: 'quit', key: 'q', label: '✕ Quit' });

  let selectedIndex = 0;
  let renderedLines = 0;

  function render() {
    if (renderedLines > 0) {
      process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
    }

    const lines = [];
    lines.push(
      '\x1b[1m\x1b[38;2;81;175;239magy-babysitter\x1b[0m \x1b[38;2;91;98;104m•\x1b[0m \x1b[38;2;223;223;223mActive Sessions\x1b[0m'
    );
    lines.push('\x1b[38;2;91;98;104m' + '─'.repeat(58) + '\x1b[0m');

    items.forEach((item, idx) => {
      const isSelected = idx === selectedIndex;
      const pointer = isSelected ? '\x1b[38;2;81;175;239m❯\x1b[0m ' : '  ';

      if (item.type === 'session') {
        const num = `\x1b[38;2;91;98;104m[${idx + 1}]\x1b[0m`;
        const nameColor = isSelected ? '\x1b[1m\x1b[38;2;81;175;239m' : '\x1b[38;2;223;223;223m';
        const displayPath = `\x1b[38;2;91;98;104m${formatDisplayPath(item.path)}\x1b[0m`;
        const badge = item.badge ? ` \x1b[38;2;152;190;101m${item.badge}\x1b[0m` : '';
        lines.push(`${pointer}${num} ${nameColor}${item.name.padEnd(20)}\x1b[0m ${displayPath}${badge}`);
      } else if (item.type === 'create') {
        const keyTag = `\x1b[38;2;91;98;104m[+]\x1b[0m`;
        const color = isSelected ? '\x1b[1m\x1b[38;2;152;190;101m' : '\x1b[38;2;152;190;101m';
        lines.push(`${pointer}${keyTag} ${color}${item.label}\x1b[0m`);
      } else if (item.type === 'restart') {
        const keyTag = `\x1b[38;2;91;98;104m[r]\x1b[0m`;
        const color = isSelected ? '\x1b[1m\x1b[38;2;236;190;123m' : '\x1b[38;2;236;190;123m';
        lines.push(`${pointer}${keyTag} ${color}${item.label}\x1b[0m`);
      } else if (item.type === 'stop') {
        const keyTag = `\x1b[38;2;91;98;104m[s]\x1b[0m`;
        const color = isSelected ? '\x1b[1m\x1b[38;2;255;108;107m' : '\x1b[38;2;255;108;107m';
        lines.push(`${pointer}${keyTag} ${color}${item.label}\x1b[0m`);
      } else if (item.type === 'logs') {
        const keyTag = `\x1b[38;2;91;98;104m[l]\x1b[0m`;
        const color = isSelected ? '\x1b[1m\x1b[38;2;70;217;255m' : '\x1b[38;2;70;217;255m';
        lines.push(`${pointer}${keyTag} ${color}${item.label}\x1b[0m`);
      } else if (item.type === 'quit') {
        const keyTag = `\x1b[38;2;91;98;104m[q]\x1b[0m`;
        const color = isSelected ? '\x1b[1m\x1b[38;2;91;98;104m' : '\x1b[38;2;91;98;104m';
        lines.push(`${pointer}${keyTag} ${color}${item.label}\x1b[0m`);
      }
    });

    lines.push('\x1b[38;2;91;98;104m' + '─'.repeat(58) + '\x1b[0m');
    lines.push(
      '\x1b[38;2;91;98;104mUse ↑/↓ to navigate, Enter to select, 1-9 to jump, q to exit\x1b[0m'
    );

    renderedLines = lines.length;
    process.stdout.write(lines.join('\n') + '\n');
  }

  process.stdout.write('\x1b[?25l'); // hide cursor
  render();

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      process.stdout.write('\x1b[?25h'); // show cursor
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch (e) {}
      }
      process.stdin.removeListener('keypress', onKeypress);
      process.stdin.pause();
    };

    const onKeypress = async (str, key) => {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        render();
        return;
      }

      if (key.name === 'down' || key.name === 'j') {
        selectedIndex = (selectedIndex + 1) % items.length;
        render();
        return;
      }

      if (key.name === 'q' || key.name === 'escape') {
        cleanup();
        process.stdout.write('\n');
        process.exit(0);
      }

      if (key.name === 'r' && !key.ctrl) {
        cleanup();
        restartService();
        await showInteractiveMenu();
        resolve();
        return;
      }

      if (key.name === 's' && !key.ctrl) {
        cleanup();
        stopService();
        process.exit(0);
      }

      if (key.name === 'l' && !key.ctrl) {
        cleanup();
        streamLogs();
        return;
      }

      if (str === '+' || key.name === 'n') {
        cleanup();
        await promptCreateSession();
        resolve();
        return;
      }

      // Check number keys 1-9
      const num = parseInt(str, 10);
      if (!isNaN(num) && num >= 1 && num <= sessions.length) {
        cleanup();
        const target = items[num - 1];
        process.stdout.write(`\n\x1b[38;2;81;175;239m➜\x1b[0m Attaching to '${target.name}'...\n\n`);
        attachSession(target.name, target.path);
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        const selected = items[selectedIndex];

        if (selected.type === 'session') {
          process.stdout.write(
            `\n\x1b[38;2;81;175;239m➜\x1b[0m Attaching to '\x1b[1m${selected.name}\x1b[0m'...\n\n`
          );
          attachSession(selected.name, selected.path);
        } else if (selected.type === 'create') {
          await promptCreateSession();
          resolve();
        } else if (selected.type === 'restart') {
          restartService();
          await showInteractiveMenu();
          resolve();
        } else if (selected.type === 'stop') {
          stopService();
          process.exit(0);
        } else if (selected.type === 'logs') {
          streamLogs();
        } else if (selected.type === 'quit') {
          process.stdout.write('\n');
          process.exit(0);
        }
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

// Main CLI Entrypoint
async function main() {
  const args = process.argv.slice(2);

  // Handle flags and subcommands
  if (args.includes('-r') || args.includes('--restart') || args.includes('restart')) {
    restartService();
    return;
  }

  if (args.includes('-k') || args.includes('--stop') || args.includes('stop')) {
    stopService();
    return;
  }

  if (args.includes('-s') || args.includes('--status') || args.includes('status')) {
    try {
      execSync('systemctl --user status agy-babysitter.service', { stdio: 'inherit' });
    } catch (e) {}
    return;
  }

  if (args.includes('-l') || args.includes('--logs') || args.includes('logs')) {
    streamLogs();
    return;
  }

  if (args.includes('-h') || args.includes('--help') || args.includes('help')) {
    console.log(`
\x1b[1m\x1b[38;2;81;175;239magyh\x1b[0m - Antigravity CLI Babysitter Helper

\x1b[1mUSAGE:\x1b[0m
  agyh                     Interactive TUI session selector
  agyh <path>              Open/create session for directory path (e.g. agyh ~/Github/my-repo)
  agyh <session-name>      Attach to or create named session
  agyh -r, --restart       Restart agy-babysitter systemd service
  agyh -k, --stop          Stop agy-babysitter systemd service
  agyh -s, --status        Check systemd service status
  agyh -l, --logs          Follow service journal logs
  agyh -h, --help          Show this help message

\x1b[1mSHORTCUT:\x1b[0m
  Press \x1b[33mCtrl+b d\x1b[0m inside any session to detach cleanly without closing it.
`);
    return;
  }

  // If a path or session name was passed as argument
  if (args.length > 0 && args[0] && !args[0].startsWith('-')) {
    await ensureServerRunning();
    const target = args[0];
    const resolvedPath = resolveTilde(target);

    // Case 1: Target is an existing directory path
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
      const targetCwd = resolvedPath;
      const sessions = listSessions();

      // Check if a session already exists pointing to this exact path
      const existingForPath = sessions.find((s) => s.cwd === targetCwd);
      if (existingForPath) {
        process.stdout.write(
          `\x1b[38;2;81;175;239m➜\x1b[0m Found active session '\x1b[1m${existingForPath.name}\x1b[0m' for \x1b[38;2;91;98;104m${formatDisplayPath(targetCwd)}\x1b[0m. Attaching...\n\n`
        );
        attachSession(existingForPath.name, targetCwd);
        return;
      }

      // Check if a session with basename exists
      const baseName = sanitizeSessionName(path.basename(targetCwd));
      const existingByName = sessions.find((s) => s.name === baseName);
      if (existingByName) {
        process.stdout.write(
          `\x1b[38;2;81;175;239m➜\x1b[0m Attaching to '\x1b[1m${existingByName.name}\x1b[0m'...\n\n`
        );
        attachSession(existingByName.name, targetCwd);
        return;
      }

      // Create new session for this path
      process.stdout.write(
        `\x1b[38;2;81;175;239m➜\x1b[0m Creating session '\x1b[1m${baseName}\x1b[0m' in \x1b[38;2;91;98;104m${formatDisplayPath(targetCwd)}\x1b[0m...\n\n`
      );
      createSession({ name: baseName, cwd: targetCwd });
      attachSession(baseName, targetCwd);
      return;
    }

    // Case 2: Target is a session name
    const sessionName = sanitizeSessionName(target);
    const sessions = listSessions();
    const existing = sessions.find((s) => s.name === sessionName);
    const sessionCwd = existing?.cwd || process.cwd();

    if (existing) {
      process.stdout.write(`\x1b[38;2;81;175;239m➜\x1b[0m Attaching to '\x1b[1m${sessionName}\x1b[0m'...\n\n`);
      attachSession(sessionName, sessionCwd);
      return;
    }

    // New named session
    process.stdout.write(
      `\x1b[38;2;81;175;239m➜\x1b[0m Creating session '\x1b[1m${sessionName}\x1b[0m' in \x1b[38;2;91;98;104m${formatDisplayPath(sessionCwd)}\x1b[0m...\n\n`
    );
    createSession({ name: sessionName, cwd: sessionCwd });
    attachSession(sessionName, sessionCwd);
    return;
  }

  // No arguments: Interactive TUI Menu
  if (process.stdin.isTTY) {
    await showInteractiveMenu();
  } else {
    // Non-interactive fallback: attach to default session
    await ensureServerRunning();
    attachSession(config.DEFAULT_SESSION, config.DEFAULT_CWD);
  }
}

main().catch((err) => {
  console.error('Error in agyh:', err);
  process.exit(1);
});
