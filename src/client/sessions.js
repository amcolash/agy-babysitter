import { writeTerminal } from './terminal.js';
import { connectTerminal, getCurrentSession, setCurrentSession, clearReconnectTimer } from './socket.js';

const sessionSelect = document.getElementById('session-select');
const btnKillSession = document.getElementById('btn-kill-session');

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

export async function loadSessions(selectSessionName = null, autoConnect = true) {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    activeSessionsList = data.sessions || [];

    sessionSelect.innerHTML = '';

    if (activeSessionsList.length === 0) {
      const defaultOption = document.createElement('option');
      defaultOption.value = 'agy-main';
      defaultOption.textContent = 'agy-main (auto-create)';
      sessionSelect.appendChild(defaultOption);
    } else {
      activeSessionsList.forEach((s) => {
        const option = document.createElement('option');
        option.value = s.name;
        option.textContent = `${s.name} [${s.path || 'default'}]${s.attached ? ' (attached)' : ''}`;
        sessionSelect.appendChild(option);
      });
    }

    let target = selectSessionName || getCurrentSession();
    if (!target) {
      const urlParams = new URLSearchParams(window.location.search);
      target = urlParams.get('session') || (activeSessionsList[0] ? activeSessionsList[0].name : 'agy-main');
    }

    sessionSelect.value = target;
    if (sessionSelect.value !== target && activeSessionsList.length > 0) {
      sessionSelect.value = activeSessionsList[0].name;
    }

    if (autoConnect && (!getCurrentSession() || getCurrentSession() !== sessionSelect.value)) {
      connectTerminal(sessionSelect.value);
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
    sessionSelect.innerHTML = '<option value="agy-main">agy-main (fallback)</option>';
    if (autoConnect && !getCurrentSession()) connectTerminal('agy-main');
  }
}

export function initSessions() {
  // Automatically refresh session list when clicking or focusing the dropdown
  sessionSelect.addEventListener('focus', () => {
    loadSessions(sessionSelect.value, false);
  });

  sessionSelect.addEventListener('change', (e) => {
    const selected = e.target.value;
    if (selected && selected !== getCurrentSession()) {
      clearReconnectTimer();
      connectTerminal(selected);
    }
  });

  btnKillSession.addEventListener('click', async () => {
    const targetSession = sessionSelect.value || getCurrentSession();
    if (!targetSession) return;

    const confirmed = confirm(`Are you sure you want to terminate tmux session '${targetSession}'?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(targetSession)}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (data.success) {
        writeTerminal(`\r\n\x1b[33m[Session '${targetSession}' terminated]\x1b[0m\r\n`);
        if (getCurrentSession() === targetSession) {
          clearReconnectTimer();
          setCurrentSession(null);
        }
        await loadSessions();
      } else {
        alert(`Could not terminate session: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to terminate session: ${err.message}`);
    }
  });
}
