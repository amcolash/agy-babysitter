import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getAugmentedPath() {
  const existingPaths = (process.env.PATH || '').split(':').filter(Boolean);
  const home = os.homedir();
  const candidates = [
    path.join(home, '.gemini', 'antigravity-cli', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.local', 'share', 'mise', 'installs', 'node', 'latest', 'bin'),
    '/home/linuxbrew/.linuxbrew/bin',
    '/home/linuxbrew/.linuxbrew/sbin',
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.nix-profile', 'bin'),
    '/nix/var/nix/profiles/default/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/local/sbin',
    '/usr/sbin',
    '/sbin'
  ];

  try {
    const sysEnv = execSync('systemctl --user show-environment 2>/dev/null', { encoding: 'utf8' });
    for (const line of sysEnv.split('\n')) {
      if (line.startsWith('PATH=')) {
        const pList = line.slice(5).split(':').filter(Boolean);
        candidates.unshift(...pList);
        break;
      }
    }
  } catch (e) {}

  const merged = [];
  const seen = new Set();
  for (const dir of [...candidates, ...existingPaths]) {
    if (!seen.has(dir) && fs.existsSync(dir)) {
      seen.add(dir);
      merged.push(dir);
    }
  }
  return merged.join(':');
}

export const AUGMENTED_PATH = getAugmentedPath();
process.env.PATH = AUGMENTED_PATH;

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];
const envPath = envCandidates.find((p) => fs.existsSync(p)) || envCandidates[0];

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

export function resolveTilde(p) {
  if (!p) return os.homedir();
  const trimmed = p.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  return path.resolve(trimmed);
}

export function formatDisplayPath(fullPath) {
  if (!fullPath) return '';
  const home = os.homedir();
  if (fullPath === home) return '~';
  if (fullPath.startsWith(home + '/')) {
    return '~' + fullPath.slice(home.length);
  }
  return fullPath;
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
