import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { stopAllWakelocks } from './wakelock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distServerScript = path.join(rootDir, 'dist', 'server', 'server.js');
const srcServerScript = path.join(__dirname, 'server.js');
const serverScript = fs.existsSync(distServerScript) ? distServerScript : srcServerScript;

// If running under systemd, use systemctl
try {
  let isSystemd = false;
  try {
    const active = execSync('systemctl --user is-active agy-babysitter.service', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (active === 'active') isSystemd = true;
  } catch (e) {}

  try {
    const enabled = execSync('systemctl --user is-enabled agy-babysitter.service', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (enabled === 'enabled') isSystemd = true;
  } catch (e) {}

  if (isSystemd) {
    console.log('Restarting agy-babysitter systemd user service...');
    try {
      execSync('fuser -k 8080/tcp 2>/dev/null || true', { stdio: 'ignore' });
    } catch (e) {}
    execSync('systemctl --user restart agy-babysitter.service', { stdio: 'inherit' });
    console.log('agy-babysitter restarted successfully via systemd.');
    process.exit(0);
  }
} catch (e) {
  // Not managed by systemd, proceed with process spawn restart
}

console.log('Building assets and server...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

console.log('Stopping existing server...');
try {
  execSync("pkill -f 'node.*server.js'", { stdio: 'ignore' });
} catch (e) {}

console.log('Stopping active wakelocks...');
stopAllWakelocks();

setTimeout(() => {
  console.log('Starting agy-babysitter server in background...');
  const proc = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    cwd: rootDir
  });
  proc.unref();
  console.log('Server restarted!');
  process.exit(0);
}, 300);
