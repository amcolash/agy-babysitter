import pty from 'node-pty';
import config from './config.js';
import { hasSession, createSession } from './tmux.js';

/**
 * Creates a PTY instance attached to a tmux session.
 * @param {Object} options
 * @param {string} [options.sessionName]
 * @param {string} [options.cwd]
 * @param {string} [options.command]
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @returns {Promise<import('node-pty').IPty>}
 */
export async function attachToTmuxSession({
  sessionName = config.DEFAULT_SESSION,
  cwd = config.DEFAULT_CWD,
  command = config.DEFAULT_COMMAND,
  cols = 80,
  rows = 24
} = {}) {
  // Ensure the session exists (or create it with specified cwd/command)
  const exists = await hasSession(sessionName);
  if (!exists) {
    await createSession({ name: sessionName, cwd, command });
  }

  // Attach to existing tmux session
  // tmux new-session -A -s <name> attaches if exists, creates if not
  const ptyProcess = pty.spawn('tmux', ['new-session', '-A', '-s', sessionName], {
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

export default {
  attachToTmuxSession
};
