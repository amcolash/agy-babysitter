import { showDisconnectedOverlay, isServerUpdatingState, startPollingServerOnline, updateStatus } from './socket.js';

/**
 * Robust JSON fetch wrapper that gracefully handles network errors, offline states,
 * and server restart HTML responses without throwing unhandled syntax errors.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function safeFetchJson(url, options = {}) {
  try {
    const res = await fetch(url, options);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (isServerUpdatingState()) {
        showDisconnectedOverlay('Server Updating...', 'The server is applying updates and restarting. Reconnecting automatically...');
      } else {
        showDisconnectedOverlay('Connecting to Server...', 'Looks like you are disconnected from the server. Attempting to reconnect...');
      }
      startPollingServerOnline();
      throw new Error(`Server returned non-JSON response (${res.status})`);
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    if (!navigator.onLine) {
      updateStatus('disconnected', 'Network offline');
      showDisconnectedOverlay('Network Offline', 'Your device appears to be offline. Reconnecting once connection is restored...');
    } else {
      if (isServerUpdatingState()) {
        showDisconnectedOverlay('Server Updating...', 'The server is applying updates and restarting. Reconnecting automatically...');
      } else {
        showDisconnectedOverlay('Connecting to Server...', 'Looks like you are disconnected from the server. Attempting to reconnect...');
      }
      startPollingServerOnline();
    }
    throw err;
  }
}

export default { safeFetchJson };
