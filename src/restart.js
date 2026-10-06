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
  const isSystemdActive = execSync('systemctl --user is-active agy-babysitter.service 2>/dev/null', { encoding: 'utf8' }).trim() === 'active';
  if (isSystemdActive) {
    console.log('Restarting agy-babysitter systemd user service...');
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
