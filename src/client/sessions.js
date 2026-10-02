import { writeTerminal } from './terminal.js';
import { connectTerminal, getCurrentSession, setCurrentSession, clearReconnectTimer } from './socket.js';
import { showToast } from './toast.js';
import { openModal } from './modal.js';

const sessionSelect = document.getElementById('session-select');
const btnKillSession = document.getElementById('btn-kill-session');
const emptySessionState = document.getElementById('empty-session-state');
const btnEmptyNewSession = document.getElementById('btn-empty-new-session');

let activeSessionsList = [];

export function getActiveSessions() {
  return activeSessionsList;
}

export function sanitizeName(name) {
  if (!name) return 'session';
  return name.trim().replace(/[^a-zA-Z0-9_\-\.]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

export function computeUniqueSessionName(folderName) {
  const base = sanitizeName(folderName);
  const existingNames = new Set(activeSessionsList.map((s) => s.name));

  if (!existingNames.has(base)) {
    return base;
  }

  let counter = 2;
  while (existingNames.has(`${base}-${counter}`)) {
    counter++;
  }

  return `${base}-${counter}`;
}

export function syncSessionToStorageAndUrl(sessionName) {
  if (!sessionName) return;
  try {
    localStorage.setItem('agy_selected_session', sessionName);
    const url = new URL(window.location);
    if (url.searchParams.get('session') !== sessionName) {
      url.searchParams.set('session', sessionName);
      window.history.replaceState(null, '', url);
    }
  } catch (e) {}
}

export function updateEmptyState(hasSessions) {
  if (emptySessionState) {
    if (hasSessions) {
      emptySessionState.classList.add('hidden');
    } else {
      emptySessionState.classList.remove('hidden');
    }
  }
}

export async function loadSessions(selectSessionName = null, autoConnect = true) {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    activeSessionsList = data.sessions || [];

    sessionSelect.innerHTML = '';
    const hasSessions = activeSessionsList.length > 0;
    updateEmptyState(hasSessions);

    if (!hasSessions) {
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'No active sessions';
      sessionSelect.appendChild(defaultOption);
    } else {
      activeSessionsList.forEach((s) => {
        const option = document.createElement('option');
        option.value = s.name;
        option.textContent = `${s.name} [${s.path || 'default'}]${s.attached ? ' (attached)' : ''}`;
        sessionSelect.appendChild(option);
      });
    }

    // Determine target session: explicit > URL param > localStorage > first available
    const urlParams = new URLSearchParams(window.location.search);
    const savedSession = localStorage.getItem('agy_selected_session');
    let target = selectSessionName || urlParams.get('session') || savedSession || getCurrentSession();

    if (target && activeSessionsList.some((s) => s.name === target)) {
      sessionSelect.value = target;
    } else if (hasSessions) {
      sessionSelect.value = activeSessionsList[0].name;
      target = sessionSelect.value;
    }

    if (hasSessions && target) {
      syncSessionToStorageAndUrl(target);
      if (autoConnect && (!getCurrentSession() || getCurrentSession() !== target)) {
        connectTerminal(target);
      }
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
    showToast(`Failed to load sessions: ${err.message}`, 'error');
  }
}

export function initSessions() {
  if (btnEmptyNewSession) {
    btnEmptyNewSession.addEventListener('click', openModal);
  }

  // Refresh session list when dropdown opens
  sessionSelect.addEventListener('focus', () => {
    loadSessions(sessionSelect.value, false);
  });

  sessionSelect.addEventListener('change', (e) => {
    const selected = e.target.value;
    if (selected && selected !== getCurrentSession()) {
      clearReconnectTimer();
      syncSessionToStorageAndUrl(selected);
      connectTerminal(selected);
    }
  });

  btnKillSession.addEventListener('click', async () => {
    const targetSession = sessionSelect.value || getCurrentSession();
    if (!targetSession) {
      showToast('No active session to terminate', 'warning');
      return;
    }

    const confirmed = confirm(`Are you sure you want to terminate session '${targetSession}'?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(targetSession)}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Terminated session '${targetSession}'`, 'info');
        writeTerminal(`\r\n\x1b[33m[Session '${targetSession}' terminated]\x1b[0m\r\n`);
        if (getCurrentSession() === targetSession) {
          clearReconnectTimer();
          setCurrentSession(null);
        }
        await loadSessions();
      } else {
        showToast(`Could not terminate session: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      showToast(`Failed to terminate session: ${err.message}`, 'error');
    }
  });
}
