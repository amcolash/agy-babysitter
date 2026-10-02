import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverScript = path.join(__dirname, 'server.js');

console.log('Building web assets...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

console.log('Stopping existing server...');
try {
  execSync("pkill -f 'node.*src/server.js'", { stdio: 'ignore' });
} catch (e) {}

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
