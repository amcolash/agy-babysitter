import pty from 'node-pty';
import config, { resolveTilde } from './config.js';
import { hasSession, createSession, sessionMeta, wrapCommandWithColorEnv } from './zellij.js';

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
  cwd,
  command,
  cols = 80,
  rows = 24
} = {}) {
  const meta = sessionMeta?.get(sessionName) || {};
  const targetCwd = resolveTilde(cwd || meta.cwd || config.DEFAULT_CWD);
  const targetCommand = command || meta.command || config.DEFAULT_COMMAND || 'agy';
  const wrappedCommand = wrapCommandWithColorEnv(targetCommand);

  const exists = await hasSession(sessionName);
  if (!exists) {
    await createSession({ name: sessionName, cwd: targetCwd, command: targetCommand });
  }

  const ptyProcess = pty.spawn('zellij', ['attach', sessionName], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: targetCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLORFGBG: '15;0',
      FORCE_COLOR: '1',
      LANG: process.env.LANG || 'en_US.UTF-8'
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
