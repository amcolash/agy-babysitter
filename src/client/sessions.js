import { writeTerminal, term, isMobileDevice } from "./terminal.js";
import {
  connectTerminal,
  disconnectTerminal,
  getCurrentSession,
  setCurrentSession,
  clearReconnectTimer,
  hideDisconnectedOverlay,
  updateStatus,
} from "./socket.js";
import { showToast } from "./toast.js";
import { openModal } from "./modal.js";
import { safeFetchJson } from "./api.js";
import {
  getSessionNotification,
  clearSessionNotification,
  setNotificationChangeCallback,
  pruneSessionNotifications,
} from "./notifications.js";

const btnOpenDrawer = document.getElementById("btn-open-drawer");
const btnCloseDrawer = document.getElementById("btn-close-drawer");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const sessionsDrawer = document.getElementById("sessions-drawer");
const btnDrawerNewSession = document.getElementById("btn-drawer-new-session");
const drawerSessionsList = document.getElementById("drawer-sessions-list");
const drawerSessionCount = document.getElementById("drawer-session-count");
const emptySessionState = document.getElementById("empty-session-state");
const btnEmptyNewSession = document.getElementById("btn-empty-new-session");
const headerSessionBadge = document.getElementById("header-session-badge");
const currentSessionLabel = document.getElementById("current-session-label");
const desktopTabsList = document.getElementById("desktop-tabs-list");
const btnDesktopNewSession = document.getElementById("btn-desktop-new-session");

let activeSessionsList = [];
let isDrawerOpen = false;

function renderStatusIcon(isActive, notif) {
  if (notif) {
    return `<span class="status-icon-container w-3.5 h-3.5 flex-shrink-0 text-[#ECBE7B] flex items-center justify-center" title="${notif === "input" ? "Waiting for input" : "Turn completed"}"><svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg></span>`;
  }
  return `<span class="status-icon-container w-2 h-2 rounded-full flex-shrink-0 ${
    isActive ? "bg-[#98be65] shadow-[0_0_6px_rgba(152,190,101,0.8)]" : "bg-[#5B6268]/50"
  }"></span>`;
}

export function getActiveSessions() {
  return activeSessionsList;
}

export function sanitizeName(name) {
  if (!name) return "session";
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9_\-\.]+/g, "-")
      .replace(/^-+|-+$/g, "") || "session"
  );
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
    localStorage.setItem("agy_selected_session", sessionName);
    const url = new URL(window.location);
    if (url.searchParams.get("session") !== sessionName) {
      url.searchParams.set("session", sessionName);
      window.history.replaceState(null, "", url);
    }
  } catch (e) {}
}

export function switchToSession(sessionName) {
  if (!sessionName) return;
  clearReconnectTimer();
  syncSessionToStorageAndUrl(sessionName);
  connectTerminal(sessionName);
  renderSessions();
}

export function switchRelativeSession(direction) {
  if (!activeSessionsList || activeSessionsList.length <= 1) return;
  const current = getCurrentSession();
  const currentIndex = activeSessionsList.findIndex((s) => s.name === current);
  let nextIndex = 0;
  if (currentIndex === -1) {
    nextIndex = direction > 0 ? 0 : activeSessionsList.length - 1;
  } else {
    nextIndex = (currentIndex + direction + activeSessionsList.length) % activeSessionsList.length;
  }
  const target = activeSessionsList[nextIndex];
  if (target) {
    switchToSession(target.name);
  }
}

export function clearSessionFromStorageAndUrl() {
  if (currentSessionLabel) {
    currentSessionLabel.textContent = "No Session";
  }
  try {
    localStorage.removeItem("agy_selected_session");
    const url = new URL(window.location);
    if (url.searchParams.has("session")) {
      url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
    }
  } catch (e) {}
}

export function openDrawer() {
  if (window.innerWidth >= 768) return;
  if (!sessionsDrawer || !drawerBackdrop) return;
  isDrawerOpen = true;
  drawerBackdrop.classList.add("open");
  sessionsDrawer.classList.add("open");
  loadSessions(getCurrentSession(), false);
}

export function closeDrawer() {
  if (!sessionsDrawer || !drawerBackdrop) return;
  isDrawerOpen = false;
  sessionsDrawer.classList.remove("open");
  drawerBackdrop.classList.remove("open");
  if (!isMobileDevice() && term) {
    term.focus();
  }
}

export function updateEmptyState(hasSessions) {
  if (emptySessionState) {
    if (hasSessions) {
      emptySessionState.classList.add("hidden");
    } else {
      emptySessionState.classList.remove("hidden");
    }
  }
}

export async function terminateSession(sessionName) {
  const confirmed = confirm(`Are you sure you want to terminate session '${sessionName}'?`);
  if (!confirmed) return false;

  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionName)}`, {
      method: "DELETE",
    });
    const data = await res.json();

    if (data.success) {
      showToast(`Terminated session '${sessionName}'`, "info");
      const wasCurrent = getCurrentSession() === sessionName;
      if (wasCurrent) {
        writeTerminal(`\r\n\x1b[33m[Session '${sessionName}' terminated]\x1b[0m\r\n`);
        disconnectTerminal();
        clearSessionFromStorageAndUrl();
      }
      await loadSessions();
      return true;
    } else {
      showToast(`Could not terminate session: ${data.error || "Unknown error"}`, "error");
      return false;
    }
  } catch (err) {
    showToast(`Failed to terminate session: ${err.message}`, "error");
    return false;
  }
}

function renderDesktopTabs() {
  if (!desktopTabsList) return;
  desktopTabsList.innerHTML = "";

  const current = getCurrentSession();

  if (activeSessionsList.length === 0) {
    desktopTabsList.innerHTML = `
      <span class="text-xs text-[#5B6268] italic px-2 flex items-center">No active sessions</span>
    `;
    return;
  }

  activeSessionsList.forEach((session) => {
    const isActive = session.name === current;
    const notif = getSessionNotification(session.name);
    const tab = document.createElement("div");

    let tabClasses =
      "session-tab group flex items-center gap-2 px-3 py-1.5 text-xs transition cursor-pointer select-none max-w-[220px] flex-shrink-0 border-r border-[#3f444a] ";
    if (isActive) {
      tabClasses += "bg-[#1b2229] text-[#DFDFDF] font-bold border-t-2 border-t-[#51afef] border-b-0";
    } else if (notif) {
      tabClasses +=
        "bg-[#282c34] text-[#DFDFDF] font-medium border-t-2 border-t-[#ECBE7B]/80 border-b border-b-[#3f444a] hover:bg-[#2d3139]";
    } else {
      tabClasses +=
        "bg-[#21242b] text-[#5B6268] hover:text-[#DFDFDF] hover:bg-[#282c34] border-t-2 border-t-transparent border-b border-b-[#3f444a]";
    }
    tab.className = tabClasses;
    tab.dataset.sessionName = session.name;
    tab.title = `${session.name} (${session.cwd || session.path || "default"})`;

    tab.innerHTML = `
      ${renderStatusIcon(isActive, notif)}
      <span class="tracking-tight truncate ${isActive ? "text-[#51afef]" : notif ? "text-[#DFDFDF]" : ""}">${session.name}</span>
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

    tab.addEventListener("click", (e) => {
      if (e.target.closest(".btn-tab-close")) return;
      if (session.name !== getCurrentSession()) {
        clearReconnectTimer();
        syncSessionToStorageAndUrl(session.name);
        connectTerminal(session.name);
        renderSessions();
      }
    });

    const btnClose = tab.querySelector(".btn-tab-close");
    if (btnClose) {
      btnClose.addEventListener("click", async (e) => {
        e.stopPropagation();
        await terminateSession(session.name);
      });
    }

    desktopTabsList.appendChild(tab);

    if (isActive) {
      setTimeout(() => {
        tab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }, 0);
    }
  });
}

function renderDrawerSessions() {
  if (!drawerSessionsList) return;
  drawerSessionsList.innerHTML = "";

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
    const notif = getSessionNotification(session.name);
    const item = document.createElement("div");
    item.dataset.sessionName = session.name;

    let itemClasses = "group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer select-none ";
    if (isActive) {
      itemClasses += "bg-[#51afef]/10 border-[#51afef]/50 shadow-sm";
    } else if (notif) {
      itemClasses += "bg-[#ECBE7B]/10 border-[#ECBE7B]/40 hover:bg-[#ECBE7B]/15";
    } else {
      itemClasses += "bg-[#1b2229] border-[#3f444a] hover:border-[#51afef]/40 hover:bg-[#1b2229]/80";
    }
    item.className = itemClasses;

    item.innerHTML = `
      <div class="flex items-center gap-2.5 flex-1 min-w-0">
        ${renderStatusIcon(isActive, notif)}
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs md:text-sm font-bold ${isActive ? "text-[#51afef]" : notif ? "text-[#DFDFDF]" : "text-[#DFDFDF]"} truncate">${session.name}</span>
            ${isActive ? '<span class="text-[9px] uppercase px-1 py-0.2 bg-[#51afef]/20 text-[#51afef] rounded font-semibold">Active</span>' : notif ? '<span class="text-[9px] uppercase px-1 py-0.2 bg-[#ECBE7B]/20 text-[#ECBE7B] rounded font-semibold">Alert</span>' : ""}
          </div>
          <span class="text-[11px] text-[#5B6268] truncate">${session.cwd || session.path || "default"}</span>
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

    drawerSessionsList.appendChild(item);
  });
}

export function updateSessionTabIcons() {
  const current = getCurrentSession();

  // Update desktop tabs icons and lightening in-place
  if (desktopTabsList) {
    const tabs = desktopTabsList.querySelectorAll(".session-tab");
    tabs.forEach((tab) => {
      const name = tab.dataset.sessionName;
      const isActive = name === current;
      const notif = getSessionNotification(name);

      if (isActive) {
        tab.className =
          "session-tab group flex items-center gap-2 px-3 py-1.5 text-xs transition cursor-pointer select-none max-w-[220px] flex-shrink-0 border-r border-[#3f444a] bg-[#1b2229] text-[#DFDFDF] font-bold border-t-2 border-t-[#51afef] border-b-0";
      } else if (notif) {
        tab.className =
          "session-tab group flex items-center gap-2 px-3 py-1.5 text-xs transition cursor-pointer select-none max-w-[220px] flex-shrink-0 border-r border-[#3f444a] bg-[#282c34] text-[#DFDFDF] font-medium border-t-2 border-t-[#ECBE7B]/80 border-b border-b-[#3f444a] hover:bg-[#2d3139]";
      } else {
        tab.className =
          "session-tab group flex items-center gap-2 px-3 py-1.5 text-xs transition cursor-pointer select-none max-w-[220px] flex-shrink-0 border-r border-[#3f444a] bg-[#21242b] text-[#5B6268] hover:text-[#DFDFDF] hover:bg-[#282c34] border-t-2 border-t-transparent border-b border-b-[#3f444a]";
      }

      const label = tab.querySelector("span.tracking-tight");
      if (label) {
        label.className = `tracking-tight truncate ${isActive ? "text-[#51afef]" : notif ? "text-[#DFDFDF]" : ""}`;
      }

      const iconContainer = tab.querySelector(".status-icon-container");
      if (iconContainer) {
        iconContainer.outerHTML = renderStatusIcon(isActive, notif);
      }
    });
  }

  // Update drawer sessions icons and lightening in-place
  if (drawerSessionsList) {
    const items = drawerSessionsList.querySelectorAll("[data-session-name]");
    items.forEach((item) => {
      const name = item.dataset.sessionName;
      const isActive = name === current;
      const notif = getSessionNotification(name);

      if (isActive) {
        item.className =
          "group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer select-none bg-[#51afef]/10 border-[#51afef]/50 shadow-sm";
      } else if (notif) {
        item.className =
          "group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer select-none bg-[#ECBE7B]/10 border-[#ECBE7B]/40 hover:bg-[#ECBE7B]/15";
      } else {
        item.className =
          "group flex items-center justify-between p-2.5 rounded-lg border transition cursor-pointer select-none bg-[#1b2229] border-[#3f444a] hover:border-[#51afef]/40 hover:bg-[#1b2229]/80";
      }

      const iconContainer = item.querySelector(".status-icon-container");
      if (iconContainer) {
        iconContainer.outerHTML = renderStatusIcon(isActive, notif);
      }
    });
  }

  // Update mobile header capsule indicator
  const headerStatusDot = document.getElementById("header-status-dot");
  if (headerStatusDot) {
    const currentNotif = current ? getSessionNotification(current) : null;
    if (currentNotif) {
      headerStatusDot.innerHTML = `<svg class="w-3.5 h-3.5 pointer-events-none text-[#ECBE7B]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>`;
      headerStatusDot.className = "w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center";
    } else {
      headerStatusDot.innerHTML = "";
      const isPaused = headerStatusDot.classList.contains("paused");
      const isDisconnected = headerStatusDot.classList.contains("disconnected");
      const isConnecting = headerStatusDot.classList.contains("connecting");
      const stateClass = isPaused ? "paused" : isDisconnected ? "disconnected" : isConnecting ? "connecting" : "connected";
      headerStatusDot.className = `dot ${stateClass} status-dot flex-shrink-0`;
    }
  }
}

export function renderSessions() {
  renderDrawerSessions();
  renderDesktopTabs();
  updateSessionTabIcons();
}

export function handleServerSessionsChanged(sessions) {
  activeSessionsList = Array.isArray(sessions) ? sessions : [];
  pruneSessionNotifications(activeSessionsList.map((s) => s.name));

  if (drawerSessionCount) {
    drawerSessionCount.textContent = String(activeSessionsList.length);
  }

  const hasSessions = activeSessionsList.length > 0;
  updateEmptyState(hasSessions);

  const current = getCurrentSession();

  if (!hasSessions) {
    if (current) {
      writeTerminal(`\r\n\x1b[33m[No active sessions remaining]\x1b[0m\r\n`);
      disconnectTerminal();
      clearSessionFromStorageAndUrl();
    }
    updateStatus("disconnected", "No active sessions");
    renderSessions();
    return;
  }

  // If a session is currently active
  if (current) {
    const isCurrentStillActive = activeSessionsList.some((s) => s.name === current);
    if (!isCurrentStillActive) {
      // Current session was closed/terminated
      showToast(`Session '${current}' ended`, "info");
      writeTerminal(`\r\n\x1b[33m[Session '${current}' ended]\x1b[0m\r\n`);

      // Switch to first available session
      const nextSession = activeSessionsList[0].name;
      clearReconnectTimer();
      syncSessionToStorageAndUrl(nextSession);
      connectTerminal(nextSession);
    }
  } else {
    // Was in no-session state, but now sessions exist
    const savedSession = localStorage.getItem("agy_selected_session");
    let target = savedSession && activeSessionsList.some((s) => s.name === savedSession) ? savedSession : activeSessionsList[0].name;
    syncSessionToStorageAndUrl(target);
    connectTerminal(target);
  }

  renderSessions();
}

export async function loadSessions(selectSessionName = null, autoConnect = true) {
  try {
    const data = await safeFetchJson("/api/sessions");
    const sessions = data.sessions || [];
    activeSessionsList = sessions;
    pruneSessionNotifications(sessions.map((s) => s.name));

    if (drawerSessionCount) {
      drawerSessionCount.textContent = String(activeSessionsList.length);
    }

    const hasSessions = activeSessionsList.length > 0;
    updateEmptyState(hasSessions);

    if (!hasSessions) {
      clearSessionFromStorageAndUrl();
      disconnectTerminal();
      updateStatus("disconnected", "No active sessions");
      renderSessions();
      if (autoConnect) {
        connectTerminal(null);
      }
      return;
    }

    // Determine target session: explicit > URL param > current > localStorage > first available
    const urlParams = new URLSearchParams(window.location.search);
    const savedSession = localStorage.getItem("agy_selected_session");
    const current = getCurrentSession();
    let target = selectSessionName;

    if (!target) {
      const urlSession = urlParams.get("session");
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
        updateStatus("connected", `Connected (${target})`);
      }
    }

    renderSessions();
  } catch (err) {
    // safeFetchJson handled disconnected overlay and recovery polling
  }
}

export function initSessions() {
  setNotificationChangeCallback(() => {
    updateSessionTabIcons();
  });

  if (desktopTabsList) {
    desktopTabsList.addEventListener("click", (e) => {
      const btnClose = e.target.closest(".btn-tab-close");
      const tab = e.target.closest(".session-tab");
      if (!tab) return;
      const sessionName = tab.dataset.sessionName;
      if (!sessionName) return;

      if (btnClose) {
        e.stopPropagation();
        terminateSession(sessionName);
        return;
      }

      if (sessionName !== getCurrentSession()) {
        clearReconnectTimer();
        syncSessionToStorageAndUrl(sessionName);
        connectTerminal(sessionName);
        renderSessions();
      }
    });
  }

  if (drawerSessionsList) {
    drawerSessionsList.addEventListener("click", (e) => {
      const btnKill = e.target.closest(".btn-kill-session");
      const item = e.target.closest("[data-session-name]");
      if (!item) return;
      const sessionName = item.dataset.sessionName;
      if (!sessionName) return;

      if (btnKill) {
        e.stopPropagation();
        terminateSession(sessionName);
        return;
      }

      if (sessionName !== getCurrentSession()) {
        clearReconnectTimer();
        syncSessionToStorageAndUrl(sessionName);
        connectTerminal(sessionName);
        renderSessions();
      }
      closeDrawer();
    });
  }

  if (btnOpenDrawer) {
    btnOpenDrawer.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    });
  }

  if (headerSessionBadge) {
    headerSessionBadge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    });
  }

  if (btnDesktopNewSession) {
    btnDesktopNewSession.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    });
  }

  if (btnCloseDrawer) {
    btnCloseDrawer.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
  }

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
  }

  if (btnDrawerNewSession) {
    btnDrawerNewSession.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
      openModal();
    });
  }

  if (btnEmptyNewSession) {
    btnEmptyNewSession.addEventListener("click", openModal);
  }

  // Escape key closes drawer if open
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isDrawerOpen) {
      closeDrawer();
    }
  });
}
