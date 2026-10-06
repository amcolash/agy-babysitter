import { writeTerminal, term, isMobileDevice } from './terminal.js';
import { connectTerminal, disconnectTerminal, getCurrentSession, setCurrentSession, clearReconnectTimer, hideDisconnectedOverlay } from './socket.js';
import { showToast } from './toast.js';
import { openModal } from './modal.js';
import { safeFetchJson } from './api.js';

const btnOpenDrawer = document.getElementById('btn-open-drawer');
const btnCloseDrawer = document.getElementById('btn-close-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const sessionsDrawer = document.getElementById('sessions-drawer');
const btnDrawerNewSession = document.getElementById('btn-drawer-new-session');
const drawerSessionsList = document.getElementById('drawer-sessions-list');
const drawerSessionCount = document.getElementById('drawer-session-count');
const emptySessionState = document.getElementById('empty-session-state');
const btnEmptyNewSession = document.getElementById('btn-empty-new-session');
const headerSessionBadge = document.getElementById('header-session-badge');
const currentSessionLabel = document.getElementById('current-session-label');

let activeSessionsList = [];
let isDrawerOpen = false;

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
  if (currentSessionLabel) {
    currentSessionLabel.textContent = sessionName;
  }
  try {
    localStorage.setItem('agy_selected_session', sessionName);
    const url = new URL(window.location);
    if (url.searchParams.get('session') !== sessionName) {
      url.searchParams.set('session', sessionName);
      window.history.replaceState(null, '', url);
    }
  } catch (e) {}
}

export function clearSessionFromStorageAndUrl() {
  if (currentSessionLabel) {
    currentSessionLabel.textContent = 'No Session';
  }
  try {
    localStorage.removeItem('agy_selected_session');
    const url = new URL(window.location);
    if (url.searchParams.has('session')) {
      url.searchParams.delete('session');
      window.history.replaceState(null, '', url);
    }
  } catch (e) {}
}

export function openDrawer() {
  if (!sessionsDrawer || !drawerBackdrop) return;
  isDrawerOpen = true;
  drawerBackdrop.classList.add('open');
  sessionsDrawer.classList.add('open');
  loadSessions(getCurrentSession(), false);
}

export function closeDrawer() {
  if (!sessionsDrawer || !drawerBackdrop) return;
  isDrawerOpen = false;
  sessionsDrawer.classList.remove('open');
  drawerBackdrop.classList.remove('open');
  if (!isMobileDevice() && term) {
    term.focus();
  }
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

function renderDrawerSessions() {
  if (!drawerSessionsList) return;
  drawerSessionsList.innerHTML = '';

  const current = getCurrentSession();

  if (activeSessionsList.length === 0) {
    drawerSessionsList.innerHTML = `
      <div class="text-xs text-[#5B6268] p-4 text-center bg-[#1b2229] border border-[#3f444a] rounded-lg">
        No active sessions
      </div>
    `;
    return;
  }

  activeSessionsList.forEach((session) => {
    const isActive = session.name === current;
    const item = document.createElement('div');
    item.className = `group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer select-none ${
      isActive
        ? 'bg-[#51afef]/10 border-[#51afef]/50 shadow-sm'
        : 'bg-[#1b2229] border-[#3f444a] hover:border-[#51afef]/40 hover:bg-[#1b2229]/80'
    }`;

    item.innerHTML = `
      <div class="flex items-center gap-2.5 flex-1 min-w-0">
        <span class="w-2 h-2 rounded-full flex-shrink-0 ${
          isActive
            ? 'bg-[#98be65] shadow-[0_0_8px_rgba(152,190,101,0.8)]'
            : 'bg-[#5B6268]'
        }"></span>
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs md:text-sm font-bold ${isActive ? 'text-[#51afef]' : 'text-[#DFDFDF]'} truncate">${session.name}</span>
            ${isActive ? '<span class="text-[9px] uppercase px-1 py-0.2 bg-[#51afef]/20 text-[#51afef] rounded font-semibold">Active</span>' : ''}
          </div>
          <span class="text-[11px] text-[#5B6268] truncate">${session.cwd || session.path || 'default'}</span>
        </div>
      </div>
      <button
        type="button"
        title="Terminate session"
        aria-label="Terminate session ${session.name}"
        class="btn-kill-session p-1.5 rounded text-[#5B6268] hover:text-[#ff6c6b] hover:bg-[#ff6c6b]/10 active:bg-[#ff6c6b]/20 transition flex-shrink-0 cursor-pointer"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;

    // Click on session row switches to that session
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-kill-session')) return;
      if (session.name !== getCurrentSession()) {
        clearReconnectTimer();
        syncSessionToStorageAndUrl(session.name);
        connectTerminal(session.name);
      }
      closeDrawer();
    });

    // Kill button handler
    const btnKill = item.querySelector('.btn-kill-session');
    if (btnKill) {
      btnKill.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = confirm(`Are you sure you want to terminate session '${session.name}'?`);
        if (!confirmed) return;

        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(session.name)}`, {
            method: 'DELETE'
          });
          const data = await res.json();

          if (data.success) {
            showToast(`Terminated session '${session.name}'`, 'info');
            if (getCurrentSession() === session.name) {
              writeTerminal(`\r\n\x1b[33m[Session '${session.name}' terminated]\x1b[0m\r\n`);
              disconnectTerminal();
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

    drawerSessionsList.appendChild(item);
  });
}

export async function loadSessions(selectSessionName = null, autoConnect = true) {
  try {
    const data = await safeFetchJson('/api/sessions');
    activeSessionsList = data.sessions || [];

    if (drawerSessionCount) {
      drawerSessionCount.textContent = String(activeSessionsList.length);
    }

    const hasSessions = activeSessionsList.length > 0;
    updateEmptyState(hasSessions);

    if (!hasSessions) {
      clearSessionFromStorageAndUrl();
      disconnectTerminal();
      renderDrawerSessions();
      return;
    }

    // Determine target session: explicit > URL param > localStorage > first available
    const urlParams = new URLSearchParams(window.location.search);
    const savedSession = localStorage.getItem('agy_selected_session');
    let target = selectSessionName || urlParams.get('session') || savedSession || getCurrentSession();

    if (target && activeSessionsList.some((s) => s.name === target)) {
      // Valid target
    } else if (hasSessions) {
      target = activeSessionsList[0].name;
    }

    renderDrawerSessions();

    if (hasSessions && target) {
      syncSessionToStorageAndUrl(target);
      if (autoConnect && (!getCurrentSession() || getCurrentSession() !== target)) {
        connectTerminal(target);
      }
    }
  } catch (err) {
    // safeFetchJson handled disconnected overlay and recovery polling
  }
}

export function initSessions() {
  if (btnOpenDrawer) {
    btnOpenDrawer.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    });
  }

  if (headerSessionBadge) {
    headerSessionBadge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    });
  }

  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
  }

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
  }

  if (btnDrawerNewSession) {
    btnDrawerNewSession.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
      openModal();
    });
  }

  if (btnEmptyNewSession) {
    btnEmptyNewSession.addEventListener('click', openModal);
  }

  // Escape key closes drawer if open
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDrawerOpen) {
      closeDrawer();
    }
  });
}
