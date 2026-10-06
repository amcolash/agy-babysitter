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
const desktopTabsList = document.getElementById('desktop-tabs-list');
const btnDesktopNewSession = document.getElementById('btn-desktop-new-session');

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
  if (window.innerWidth >= 768) return;
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

export async function terminateSession(sessionName) {
  const confirmed = confirm(`Are you sure you want to terminate session '${sessionName}'?`);
  if (!confirmed) return false;

  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Terminated session '${sessionName}'`, 'info');
      const wasCurrent = getCurrentSession() === sessionName;
      if (wasCurrent) {
        writeTerminal(`\r\n\x1b[33m[Session '${sessionName}' terminated]\x1b[0m\r\n`);
        disconnectTerminal();
        clearSessionFromStorageAndUrl();
      }
      await loadSessions();
      return true;
    } else {
      showToast(`Could not terminate session: ${data.error || 'Unknown error'}`, 'error');
      return false;
    }
  } catch (err) {
    showToast(`Failed to terminate session: ${err.message}`, 'error');
    return false;
  }
}

function renderDesktopTabs() {
  if (!desktopTabsList) return;
  desktopTabsList.innerHTML = '';

  const current = getCurrentSession();

  if (activeSessionsList.length === 0) {
    desktopTabsList.innerHTML = `
      <span class="text-xs text-[#5B6268] italic px-2">No active sessions</span>
    `;
    return;
  }

  activeSessionsList.forEach((session) => {
    const isActive = session.name === current;
    const tab = document.createElement('div');
    tab.className = `session-tab group flex items-center gap-2 px-3 py-1.5 text-xs transition cursor-pointer select-none max-w-[220px] flex-shrink-0 border-r border-[#3f444a] ${
      isActive
        ? 'bg-[#1b2229] text-[#DFDFDF] font-bold border-t-2 border-t-[#51afef] border-b-0'
        : 'bg-[#21242b] text-[#5B6268] hover:text-[#DFDFDF] hover:bg-[#282c34] border-t-2 border-t-transparent border-b border-b-[#3f444a]'
    }`;
    tab.dataset.sessionName = session.name;
    tab.title = `${session.name} (${session.cwd || session.path || 'default'})`;

    tab.innerHTML = `
      <span class="w-2 h-2 rounded-full flex-shrink-0 ${
        isActive
          ? 'bg-[#98be65] shadow-[0_0_6px_rgba(152,190,101,0.8)]'
          : 'bg-[#5B6268]/50'
      }"></span>
      <span class="tracking-tight truncate ${isActive ? 'text-[#51afef]' : ''}">${session.name}</span>
      <button
        type="button"
        title="Close session ${session.name}"
        aria-label="Close session ${session.name}"
        class="btn-tab-close p-0.5 rounded text-[#5B6268] hover:text-[#ff6c6b] hover:bg-[#ff6c6b]/15 active:bg-[#ff6c6b]/30 transition flex-shrink-0 cursor-pointer ml-1"
      >
        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    `;

    tab.addEventListener('click', (e) => {
      if (e.target.closest('.btn-tab-close')) return;
      if (session.name !== getCurrentSession()) {
        clearReconnectTimer();
        syncSessionToStorageAndUrl(session.name);
        connectTerminal(session.name);
        renderSessions();
      }
    });

    const btnClose = tab.querySelector('.btn-tab-close');
    if (btnClose) {
      btnClose.addEventListener('click', async (e) => {
        e.stopPropagation();
        await terminateSession(session.name);
      });
    }

    desktopTabsList.appendChild(tab);

    if (isActive) {
      setTimeout(() => {
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }, 0);
    }
  });
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
        renderSessions();
      }
      closeDrawer();
    });

    // Kill button handler
    const btnKill = item.querySelector('.btn-kill-session');
    if (btnKill) {
      btnKill.addEventListener('click', async (e) => {
        e.stopPropagation();
        await terminateSession(session.name);
      });
    }

    drawerSessionsList.appendChild(item);
  });
}

export function renderSessions() {
  renderDrawerSessions();
  renderDesktopTabs();
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
      updateStatus('disconnected', 'No active sessions');
      renderSessions();
      return;
    }

    // Determine target session: explicit > URL param > current > localStorage > first available
    const urlParams = new URLSearchParams(window.location.search);
    const savedSession = localStorage.getItem('agy_selected_session');
    const current = getCurrentSession();
    let target = selectSessionName;

    if (!target) {
      const urlSession = urlParams.get('session');
      if (urlSession && activeSessionsList.some((s) => s.name === urlSession)) {
        target = urlSession;
      } else if (current && activeSessionsList.some((s) => s.name === current)) {
        target = current;
      } else if (savedSession && activeSessionsList.some((s) => s.name === savedSession)) {
        target = savedSession;
      } else {
        target = activeSessionsList[0].name;
      }
    }

    // Fallback if target is not in current active sessions
    if (!activeSessionsList.some((s) => s.name === target)) {
      target = activeSessionsList[0].name;
    }

    syncSessionToStorageAndUrl(target);

    if (autoConnect) {
      if (!getCurrentSession() || getCurrentSession() !== target) {
        connectTerminal(target);
      } else {
        updateStatus('connected', `Connected (${target})`);
      }
    }

    renderSessions();
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

  if (btnDesktopNewSession) {
    btnDesktopNewSession.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
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
