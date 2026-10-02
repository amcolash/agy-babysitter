import pty from 'node-pty';
import config from './config.js';
import { hasSession, createSession } from './zellij.js';

/**
 * Creates a PTY instance attached to a zellij session.
 * @param {Object} options
 * @param {string} [options.sessionName]
 * @param {string} [options.cwd]
 * @param {string} [options.command]
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @returns {Promise<import('node-pty').IPty>}
 */
export async function attachToSession({
  sessionName = config.DEFAULT_SESSION,
  cwd = config.DEFAULT_CWD,
  command = config.DEFAULT_COMMAND,
  cols = 80,
  rows = 24
} = {}) {
  const exists = await hasSession(sessionName);
  if (!exists) {
    await createSession({ name: sessionName, cwd, command });
  }

  const ptyProcess = pty.spawn('zellij', ['attach', '-c', sessionName, '--', 'bash', '-c', command || 'agy'], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd || config.DEFAULT_CWD,
    env: {
      ...process.env,
      TERM: 'xterm-256color'
    }
  });

  return ptyProcess;
}

// Alias for backwards compatibility
export const attachToTmuxSession = attachToSession;

export default {
  attachToSession,
  attachToTmuxSession
};
