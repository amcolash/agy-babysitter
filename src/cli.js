import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config, { resolveTilde } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverScript = path.join(__dirname, 'server.js');
const rootDir = path.resolve(__dirname, '..');

function isServerRunning() {
  try {
    const stdout = execSync('pgrep -f "node.*src/server.js"', {
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

if (!fs.existsSync(targetCwd)) {
  fs.mkdirSync(targetCwd, { recursive: true });
}

ensureServerRunning();

const zellijArgs = ['attach', '-c', sessionName, '--', 'bash', '-c', targetCommand];
const zellij = spawn('zellij', zellijArgs, {
  cwd: targetCwd,
  stdio: 'inherit'
});

zellij.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
