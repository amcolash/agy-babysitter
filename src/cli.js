import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config, { resolveTilde } from './config.js';

const __filename = fileURLToPath(import.meta.url);
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

function ensureServerRunning() {
  if (!isServerRunning()) {
    console.log('Starting agy-babysitter server in background...');
    const proc = spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: 'ignore',
      cwd: rootDir
    });
    proc.unref();
  }
}

// Extract session name from CLI argument or fallback to config default
const args = process.argv.slice(2);
let sessionName = config.DEFAULT_SESSION;
if (args.length > 0 && args[0] && !args[0].startsWith('-')) {
  sessionName = args[0];
}

const targetCwd = resolveTilde(config.DEFAULT_CWD);
const targetCommand = config.DEFAULT_COMMAND || 'agy';
const wrappedCommand = `export TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=1 CLICOLOR=1 CLICOLOR_FORCE=1; exec ${targetCommand}`;

if (!fs.existsSync(targetCwd)) {
  fs.mkdirSync(targetCwd, { recursive: true });
}

ensureServerRunning();

const zellijArgs = ['attach', '-c', sessionName, '--', 'bash', '-c', wrappedCommand];
const zellij = spawn('zellij', zellijArgs, {
  cwd: targetCwd,
  stdio: 'inherit'
});

zellij.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
