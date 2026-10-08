import { connectTerminal } from './socket.js';
import { loadSessions, computeUniqueSessionName, getActiveSessions, switchToSession } from './sessions.js';
import { showToast } from './toast.js';
import { safeFetchJson } from './api.js';

const modalOverlay = document.getElementById('modal-overlay');
const btnOpenModal = document.getElementById('btn-open-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const createSessionForm = document.getElementById('create-session-form');

const recentSessionsContainer = document.getElementById('recent-sessions-container');
const recentSessionsList = document.getElementById('recent-sessions-list');

const newSessionNameInput = document.getElementById('new-session-name');
const newSessionCwdInput = document.getElementById('new-session-cwd');
const selectedCwdDisplay = document.getElementById('selected-cwd-display');
const newSessionCommandInput = document.getElementById('new-session-command');

const pickerRootTabs = document.getElementById('picker-root-tabs');
const pickerSearchInput = document.getElementById('picker-search-input');
const pickerFolderList = document.getElementById('picker-folder-list');

let allowedRoots = [];
let activeRootIndex = 0;
let selectedCwd = '';
let defaultCwd = '';

export function setSelectedCwd(folderPath, displayName = null, baseFolderName = null) {
  selectedCwd = folderPath;
  newSessionCwdInput.value = folderPath;
  selectedCwdDisplay.textContent = displayName || folderPath;
  selectedCwdDisplay.title = folderPath;

  const folderBase = baseFolderName || (folderPath.split('/').filter(Boolean).pop() || 'session');
  newSessionNameInput.value = computeUniqueSessionName(folderBase);
}

export async function loadRecentSessions() {
  if (!recentSessionsContainer || !recentSessionsList) return;
  try {
    const data = await safeFetchJson('/api/sessions/recent?limit=4');
    const recent = data.recent || [];

    if (recent.length === 0) {
      recentSessionsContainer.classList.add('hidden');
      recentSessionsList.innerHTML = '';
      return;
    }

    recentSessionsList.innerHTML = '';
    recent.forEach((session) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className =
        'recent-session-chip group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#1b2229] hover:bg-[#282c34] border border-[#3f444a] hover:border-[#51afef] transition duration-150 text-left cursor-pointer active:scale-95';
      chip.title = `${session.name} (${session.cwd}) [${session.command || 'agy'}]`;
      chip.innerHTML = `
        <span class="text-sm text-[#51afef]">📁</span>
        <div class="flex flex-col min-w-0">
          <span class="text-xs font-bold text-[#DFDFDF] group-hover:text-[#51afef] truncate">${session.name}</span>
          <span class="text-[10px] text-[#5B6268] font-mono truncate max-w-[140px] sm:max-w-[200px]">${session.displayPath || session.cwd}</span>
        </div>
      `;

      chip.addEventListener('click', () => {
        applyRecentSession(session);
      });

      recentSessionsList.appendChild(chip);
    });

    recentSessionsContainer.classList.remove('hidden');
  } catch (err) {
    recentSessionsContainer.classList.add('hidden');
  }
}

function applyRecentSession(session) {
  const folderBase = session.cwd.split('/').filter(Boolean).pop() || session.name;
  setSelectedCwd(session.cwd, session.displayPath || session.cwd, folderBase);

  if (allowedRoots && allowedRoots.length > 0) {
    const rootIdx = allowedRoots.findIndex((r) =>
      (r.folders || []).some((f) => f.path === session.cwd)
    );
    if (rootIdx !== -1) {
      activeRootIndex = rootIdx;
      renderRootTabs();
      renderFolderList();
    }
  }

  const activeNames = getActiveSessions().map((s) => s.name);
  if (activeNames.includes(session.name)) {
    newSessionNameInput.value = computeUniqueSessionName(session.name);
  } else {
    newSessionNameInput.value = session.name;
  }

  newSessionCommandInput.value = session.command || 'agy';
  newSessionNameInput.focus();
}

let modalOpenedAt = 0;

export function openModal() {
  modalOpenedAt = Date.now();
  modalOverlay.classList.remove('hidden');
  pickerSearchInput.value = '';
  loadSessions();
  loadAllowedDirectories();
  loadRecentSessions();
  newSessionNameInput.focus();
}

export function closeModal() {
  modalOverlay.classList.add('hidden');
}

export async function loadAllowedDirectories() {
  pickerFolderList.innerHTML = '<div class="picker-loading text-xs text-[#5B6268] p-3 text-center">Loading allowed directories...</div>';
  try {
    const data = await safeFetchJson('/api/directories');
    allowedRoots = data.roots || [];

    const allFolders = allowedRoots.flatMap((r) => r.folders || []);
    const isValidSelected = allFolders.some((f) => f.path === selectedCwd);

    if (isValidSelected) {
      const rootIdx = allowedRoots.findIndex((r) => (r.folders || []).some((f) => f.path === selectedCwd));
      if (rootIdx !== -1) {
        activeRootIndex = rootIdx;
      }
    } else {
      // Find first root with at least one folder, or fallback to 0
      const firstNonEmptyRootIdx = allowedRoots.findIndex((r) => (r.folders || []).length > 0);
      activeRootIndex = firstNonEmptyRootIdx !== -1 ? firstNonEmptyRootIdx : 0;

      const firstFolder = allowedRoots[activeRootIndex]?.folders?.[0] || allFolders[0];
      if (firstFolder) {
        setSelectedCwd(firstFolder.path, firstFolder.displayPath || firstFolder.name, firstFolder.name);
      } else {
        selectedCwd = '';
        newSessionCwdInput.value = '';
        selectedCwdDisplay.textContent = 'None selected';
        selectedCwdDisplay.title = '';
        newSessionNameInput.value = '';
      }
    }

    renderRootTabs();
    renderFolderList();
  } catch (err) {
    pickerFolderList.innerHTML = `<div class="picker-empty text-xs text-[#ff6c6b] p-3 text-center">${err.message}</div>`;
  }
}

function renderRootTabs() {
  pickerRootTabs.innerHTML = '';
  allowedRoots.forEach((root, idx) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `root-tab ${idx === activeRootIndex ? 'active' : ''}`;
    tab.textContent = `📁 ${root.name}`;
    tab.title = root.path;
    tab.addEventListener('click', () => {
      activeRootIndex = idx;
      renderRootTabs();
      pickerSearchInput.value = '';
      renderFolderList();
    });
    pickerRootTabs.appendChild(tab);
  });
}

function renderFolderList() {
  const activeRoot = allowedRoots[activeRootIndex];
  if (!activeRoot) {
    pickerFolderList.innerHTML = '<div class="picker-empty text-xs text-[#5B6268] p-3 text-center">No allowed directories found</div>';
    return;
  }

  const query = (pickerSearchInput.value || '').toLowerCase().trim();
  const folders = activeRoot.folders || [];
  const matched = query
    ? folders.filter((f) => f.name.toLowerCase().includes(query))
    : folders;

  pickerFolderList.innerHTML = '';

  if (folders.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty text-xs text-[#5B6268] p-3 text-center';
    empty.textContent = `No subdirectories found in ${activeRoot.name}`;
    pickerFolderList.appendChild(empty);
    return;
  }

  if (matched.length === 0 && query) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty text-xs text-[#5B6268] p-3 text-center';
    empty.textContent = `No folders matching "${query}"`;
    pickerFolderList.appendChild(empty);
    return;
  }

  matched.forEach((folder) => {
    const item = document.createElement('div');
    item.className = `picker-item ${selectedCwd === folder.path ? 'active' : ''}`;
    const checkIcon = selectedCwd === folder.path ? '<span class="picker-check">✓</span>' : '';
    item.innerHTML = `<span class="picker-item-icon">📁</span><span class="picker-item-name">${folder.name}</span>${checkIcon}`;
    item.addEventListener('click', () => {
      setSelectedCwd(folder.path, folder.displayPath || folder.name, folder.name);
      renderFolderList();
    });
    pickerFolderList.appendChild(item);
  });
}

export async function initInfo() {
  try {
    const info = await safeFetchJson('/api/info');
    defaultCwd = info.defaultCwd || '';
    newSessionCommandInput.value = info.defaultCommand || 'agy';
  } catch (err) {
    // Graceful fallback when restarting or offline
  }
}

export function initModal() {
  loadRecentSessions();

  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', openModal);
  }
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeModal);
  }
  if (btnCancelModal) {
    btnCancelModal.addEventListener('click', closeModal);
  }

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay && Date.now() - modalOpenedAt > 350) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
      closeModal();
    }
  });

  pickerSearchInput.addEventListener('input', () => {
    renderFolderList();
  });

  createSessionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newSessionNameInput.value.trim();
    const cwd = newSessionCwdInput.value.trim();
    const command = newSessionCommandInput.value.trim() || 'agy';

    if (!cwd) {
      showToast('Please select a subdirectory from one of the allowed folders.', 'warning');
      return;
    }

    try {
      const data = await safeFetchJson('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cwd, command })
      });

      closeModal();
      loadRecentSessions();
      showToast(`Created session '${data.name || name}'`, 'success');
      await loadSessions(data.name || name);
      switchToSession(data.name || name);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}
