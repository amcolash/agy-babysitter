import { connectTerminal } from './socket.js';
import { loadSessions, computeUniqueSessionName } from './sessions.js';
import { showToast } from './toast.js';

const modalOverlay = document.getElementById('modal-overlay');
const btnOpenModal = document.getElementById('btn-open-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const createSessionForm = document.getElementById('create-session-form');

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

export function openModal() {
  modalOverlay.classList.remove('hidden');
  pickerSearchInput.value = '';
  loadSessions();
  loadAllowedDirectories();
  newSessionNameInput.focus();
}

export function closeModal() {
  modalOverlay.classList.add('hidden');
}

export async function loadAllowedDirectories() {
  pickerFolderList.innerHTML = '<div class="picker-loading text-xs text-[#5B6268] p-3 text-center">Loading allowed directories...</div>';
  try {
    const res = await fetch('/api/directories');
    if (!res.ok) throw new Error('Failed to load directories');
    const data = await res.json();
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
    const res = await fetch('/api/info');
    const info = await res.json();
    defaultCwd = info.defaultCwd || '';
    newSessionCommandInput.value = info.defaultCommand || 'agy';
  } catch (err) {
    console.error('Failed to load info:', err);
  }
}

export function initModal() {
  btnOpenModal.addEventListener('click', openModal);
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
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
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cwd, command })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create session');
      }

      const data = await res.json();
      closeModal();
      showToast(`Created session '${data.name || name}'`, 'success');
      await loadSessions(data.name || name);
      connectTerminal(data.name || name);
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  });
}
