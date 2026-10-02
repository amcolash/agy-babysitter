import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');

// Automatically load .env if present
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    // Ignore error if .env file does not exist
  }
} else if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...rest] = trimmed.split('=');
        const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) {
          process.env[key.trim()] = val;
        }
      }
    }
  } catch (e) {
    // Ignore error
  }
}

function resolveTilde(p) {
  if (!p) return os.homedir();
  const trimmed = p.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  return path.resolve(trimmed);
}

function parseAllowedDirectories(raw) {
  if (!raw) {
    return [
      resolveTilde('~/Dev'),
      resolveTilde('~/Desktop'),
      resolveTilde('~/Github')
    ];
  }

  const trimmed = raw.trim();
  let entries = [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      entries = JSON.parse(trimmed);
    } catch (e) {
      entries = trimmed.slice(1, -1).split(',').map(s => s.replace(/^["']|["']$/g, '').trim());
    }
  } else {
    entries = trimmed.split(',').map(s => s.trim());
  }

  return entries.filter(Boolean).map(resolveTilde);
}

export const PORT = parseInt(process.env.PORT, 10) || 8080;
export const HOST = process.env.HOST || '0.0.0.0';
export const DEFAULT_SESSION = process.env.DEFAULT_SESSION || 'agy-main';
export const DEFAULT_COMMAND = process.env.DEFAULT_COMMAND || 'agy';
export const ALLOWED_DIRECTORIES = parseAllowedDirectories(process.env.ALLOWED_DIRECTORIES);
export const DEFAULT_CWD = resolveTilde(process.env.DEFAULT_CWD || ALLOWED_DIRECTORIES[0] || os.homedir());

export const WAKELOCK_TIMEOUT_MINUTES = parseInt(process.env.WAKELOCK_TIMEOUT_MINUTES, 10) || 20;

export default {
  PORT,
  HOST,
  DEFAULT_SESSION,
  DEFAULT_COMMAND,
  ALLOWED_DIRECTORIES,
  DEFAULT_CWD,
  WAKELOCK_TIMEOUT_MINUTES
};
