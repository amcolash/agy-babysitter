import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distServerDir = path.join(rootDir, 'dist', 'server');

// Clean and recreate dist/server directory
fs.rmSync(distServerDir, { recursive: true, force: true });
fs.mkdirSync(distServerDir, { recursive: true });

// Copy all server files and routes (excluding src/client/)
const entries = fs.readdirSync(srcDir, { withFileTypes: true });
for (const entry of entries) {
  if (entry.name === 'client') continue; // Vite compiles src/client -> dist/client
  const srcPath = path.join(srcDir, entry.name);
  const destPath = path.join(distServerDir, entry.name);

  if (entry.isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
  } else if (entry.isFile()) {
    fs.copyFileSync(srcPath, destPath);
  }
}

console.log('✓ Server code copied to dist/server/');
