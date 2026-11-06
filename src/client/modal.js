import { connectTerminal, getCurrentSession } from './socket.js';
import { loadSessions, computeUniqueSessionName, getActiveSessions, switchToSession } from './sessions.js';
import { showToast } from './toast.js';
import { safeFetchJson } from './api.js';
import { term, isMobileDevice } from './terminal.js';

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
  if (newSessionNameInput) {
    newSessionNameInput.value = computeUniqueSessionName(folderBase);
  }
}

export async function loadRecentSessions() {
  if (!recentSessionsContainer || !recentSessionsList) return [];
  try {
    const data = await safeFetchJson('/api/sessions/recent?limit=4');
    const recent = data.recent || [];

    if (recent.length === 0) {
      recentSessionsContainer.classList.add('hidden');
      recentSessionsList.innerHTML = '';
      return [];
    }

    recentSessionsList.innerHTML = '';
    recent.forEach((session) => {
      const folderBase = session.cwd.split('/').filter(Boolean).pop() || session.name || 'folder';
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className =
        'recent-session-chip group flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#1b2229] hover:bg-[#282c34] border border-[#3f444a] hover:border-[#51afef] transition duration-150 text-left cursor-pointer active:scale-95';
      chip.title = `${folderBase} (${session.cwd})`;
      chip.innerHTML = `
        <span class="text-sm text-[#51afef]">📁</span>
        <div class="flex flex-col min-w-0">
          <span class="text-xs font-bold text-[#DFDFDF] group-hover:text-[#51afef] truncate">${folderBase}</span>
          <span class="text-[10px] text-[#5B6268] font-mono truncate max-w-[140px] sm:max-w-[200px]">${session.displayPath || session.cwd}</span>
        </div>
      `;

      chip.addEventListener('click', () => {
        applyRecentFolder(session);
      });

      recentSessionsList.appendChild(chip);
    });

    recentSessionsContainer.classList.remove('hidden');
    return recent;
  } catch (err) {
    recentSessionsContainer.classList.add('hidden');
    return [];
  }
}

function applyRecentFolder(folderEntry) {
  const folderBase = folderEntry.cwd.split('/').filter(Boolean).pop() || folderEntry.name || 'session';
  setSelectedCwd(folderEntry.cwd, folderEntry.displayPath || folderEntry.cwd, folderBase);

  if (allowedRoots && allowedRoots.length > 0) {
    const rootIdx = allowedRoots.findIndex((r) =>
      (r.folders || []).some((f) => f.path === folderEntry.cwd)
    );
    if (rootIdx !== -1) {
      activeRootIndex = rootIdx;
      renderRootTabs();
      renderFolderList();
    }
  }

  if (folderEntry.command && newSessionCommandInput) {
    newSessionCommandInput.value = folderEntry.command;
  }
  if (newSessionNameInput) {
    newSessionNameInput.focus();
  }
}

function getLatestDirectory(recentList = []) {
  // 1. Current active session
  const currentSessionName = getCurrentSession();
  const activeSessions = getActiveSessions();
  const currentSession = activeSessions.find((s) => s.name === currentSessionName);
  if (currentSession && currentSession.cwd) {
    return { cwd: currentSession.cwd, command: currentSession.command };
  }

  // 2. Most recent session from history
  if (recentList && recentList.length > 0 && recentList[0].cwd) {
    return { cwd: recentList[0].cwd, command: recentList[0].command };
  }

  // 3. Any active session
  if (activeSessions.length > 0 && activeSessions[0].cwd) {
    return { cwd: activeSessions[0].cwd, command: activeSessions[0].command };
  }

  // 4. Default CWD from server config
  if (defaultCwd) {
    return { cwd: defaultCwd, command: null };
  }

  return null;
}

let modalOpenedAt = 0;

export async function openModal() {
  modalOpenedAt = Date.now();
  modalOverlay.classList.remove('hidden');
  pickerSearchInput.value = '';

  try {
    const [_, recent] = await Promise.all([
      loadSessions(null, false),
      loadRecentSessions()
    ]);
    await loadAllowedDirectories(recent);
  } catch (err) {
    // Graceful error handling in individual loaders
  }

  if (newSessionNameInput) {
    newSessionNameInput.focus();
    newSessionNameInput.select();
  } else if (pickerSearchInput) {
    pickerSearchInput.focus();
  }
}

export function closeModal() {
  modalOverlay.classList.add('hidden');
  if (!isMobileDevice() && term) {
    term.focus();
  }
}

export async function loadAllowedDirectories(recentList = null) {
  pickerFolderList.innerHTML = '<div class="picker-loading text-xs text-[#5B6268] p-3 text-center">Loading allowed directories...</div>';
  try {
    const data = await safeFetchJson('/api/directories');
    allowedRoots = data.roots || [];

    const allFolders = allowedRoots.flatMap((r) => r.folders || []);
    const latest = getLatestDirectory(recentList);
    const targetCwd = latest ? latest.cwd : null;

    let matchedFolder = null;
    let matchedRootIdx = -1;

    if (targetCwd) {
      for (let i = 0; i < allowedRoots.length; i++) {
        const root = allowedRoots[i];
        const folder = (root.folders || []).find((f) => f.path === targetCwd);
        if (folder) {
          matchedFolder = folder;
          matchedRootIdx = i;
          break;
        }
      }
    }

    if (matchedFolder && matchedRootIdx !== -1) {
      activeRootIndex = matchedRootIdx;
      setSelectedCwd(matchedFolder.path, matchedFolder.displayPath || matchedFolder.name, matchedFolder.name);
      if (latest && latest.command && newSessionCommandInput) {
        newSessionCommandInput.value = latest.command;
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
        if (newSessionNameInput) {
          newSessionNameInput.value = '';
        }
      }
    }

    renderRootTabs();
    renderFolderList();
  } catch (err) {
    pickerFolderList.innerHTML = `<div class="picker-empty text-xs text-[#ff6c6b] p-3 text-center">${err.message}</div>`;
  }
}

/**
 * Damerau-Levenshtein distance calculation
 */
function damerauLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const al = a.length;
  const bl = b.length;
  const d = [];
  for (let i = 0; i <= al; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= bl; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,        // deletion
        d[i][j - 1] + 1,        // insertion
        d[i - 1][j - 1] + cost   // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[al][bl];
}

/**
 * Fuzzy score for a text given a query:
 * Returns score > 0 if matched, 0 if no match.
 * Incorporates exact matching, prefix, word boundary, subsequence (fzf-style),
 * and Damerau-Levenshtein distance for typo forgiveness.
 */
function fuzzyScore(query, text) {
  const q = (query || '').toLowerCase().trim();
  const t = (text || '').toLowerCase().trim();

  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 850 - (t.length - q.length);
  if (t.includes(q)) return 700 - t.indexOf(q) * 2;

  // Check word prefixes (e.g. "race" matching "drag-race")
  const words = t.split(/[-_.\s/]+/);
  for (let i = 0; i < words.length; i++) {
    if (words[i].startsWith(q)) {
      return 650 - i * 5;
    }
  }

  // Subsequence match (fzf style)
  let qIdx = 0;
  let subScore = 0;
  let consecutive = 0;
  let lastMatchIdx = -1;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      qIdx++;
      subScore += 15;
      if (lastMatchIdx === i - 1) {
        consecutive++;
        subScore += consecutive * 10;
      } else {
        consecutive = 0;
      }
      if (i === 0 || /[-_.\s/]/.test(t[i - 1])) {
        subScore += 25;
      }
      lastMatchIdx = i;
    }
  }
  if (qIdx === q.length) {
    return Math.max(400, 300 + subScore);
  }

  // Typo tolerance via sliding-window Damerau-Levenshtein
  const maxAllowedDist = q.length <= 2 ? 0 : (q.length <= 5 ? 1 : 2);
  if (maxAllowedDist > 0) {
    let minDist = Infinity;
    const minLen = Math.max(1, q.length - maxAllowedDist);
    const maxLen = q.length + maxAllowedDist;

    for (let len = minLen; len <= maxLen; len++) {
      for (let start = 0; start <= t.length - len; start++) {
        const window = t.slice(start, start + len);
        const dist = damerauLevenshtein(q, window);
        if (dist < minDist) {
          minDist = dist;
          if (minDist === 0) break;
        }
      }
      if (minDist === 0) break;
    }

    if (minDist <= maxAllowedDist) {
      return 250 - minDist * 70;
    }
  }

  return 0;
}

function getAllFolders() {
  const list = [];
  allowedRoots.forEach((root, rootIdx) => {
    (root.folders || []).forEach((folder) => {
      list.push({
        ...folder,
        rootName: root.name,
        rootPath: root.path,
        rootIndex: rootIdx
      });
    });
  });
  return list;
}

function selectFolder(folder) {
  setSelectedCwd(folder.path, folder.displayPath || folder.name, folder.name);
  if (folder.rootIndex !== undefined && folder.rootIndex !== -1 && folder.rootIndex !== activeRootIndex) {
    activeRootIndex = folder.rootIndex;
    renderRootTabs();
  }
  renderFolderList();
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
  const query = (pickerSearchInput.value || '').trim();

  pickerFolderList.innerHTML = '';

  if (!activeRoot && allowedRoots.length === 0) {
    pickerFolderList.innerHTML = '<div class="picker-empty text-xs text-[#5B6268] p-3 text-center">No allowed directories found</div>';
    return;
  }

  let foldersToDisplay = [];

  if (query) {
    // Search across ALL roots!
    const allFolders = getAllFolders();
    const scored = [];

    for (const folder of allFolders) {
      let score = fuzzyScore(query, folder.name);

      // If name didn't match, also check displayPath
      if (score === 0 && folder.displayPath) {
        const pathScore = fuzzyScore(query, folder.displayPath);
        if (pathScore > 0) {
          score = Math.floor(pathScore * 0.7);
        }
      }

      if (score > 0) {
        // Folder from currently active root tab gets a boost
        if (activeRoot && folder.rootPath === activeRoot.path) {
          score += 100;
        }

        scored.push({ folder, score });
      }
    }

    // Sort by score descending, then alphabetically
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.folder.name.localeCompare(b.folder.name, undefined, { sensitivity: 'base' });
    });

    foldersToDisplay = scored.map((s) => s.folder);
  } else {
    // No search query: display active root folders, with selected sub-folder on top
    const rootFolders = (activeRoot ? activeRoot.folders || [] : []).map((f) => ({
      ...f,
      rootName: activeRoot.name,
      rootPath: activeRoot.path,
      rootIndex: activeRootIndex
    }));

    // Sort alphabetically
    rootFolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    foldersToDisplay = rootFolders;
  }

  if (foldersToDisplay.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty text-xs text-[#5B6268] p-3 text-center';
    empty.textContent = query
      ? `No folders matching "${query}"`
      : `No subdirectories found in ${activeRoot ? activeRoot.name : 'selected root'}`;
    pickerFolderList.appendChild(empty);
    return;
  }

  foldersToDisplay.forEach((folder) => {
    const isSelected = selectedCwd === folder.path;
    const item = document.createElement('div');
    item.className = `picker-item ${isSelected ? 'active' : ''}`;
    item.dataset.folderPath = folder.path;

    const checkIcon = isSelected ? '<span class="picker-check ml-auto text-xs text-[#51afef] font-bold">✓</span>' : '';
    const rootBadge = query && folder.rootName
      ? `<span class="text-[10px] text-[#5B6268] font-mono shrink-0 bg-[#1b2229] border border-[#3f444a] px-1.5 py-0.5 rounded ml-auto">${folder.rootName}</span>`
      : '';

    item.innerHTML = `
      <span class="picker-item-icon">📁</span>
      <span class="picker-item-name font-medium truncate">${folder.name}</span>
      ${rootBadge}
      ${checkIcon}
    `;

    item.addEventListener('click', () => {
      selectFolder(folder);
    });

    pickerFolderList.appendChild(item);
  });

  const activeItem = pickerFolderList.querySelector('.picker-item.active');
  if (activeItem) {
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

export async function initInfo() {
  try {
    const info = await safeFetchJson('/api/info');
    defaultCwd = info.defaultCwd || '';
    if (newSessionCommandInput) {
      newSessionCommandInput.value = info.defaultCommand || 'agy';
    }
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

  pickerSearchInput.addEventListener('keydown', (e) => {
    const items = Array.from(pickerFolderList.querySelectorAll('.picker-item'));
    if (items.length === 0) return;

    const currentIdx = items.findIndex((el) => el.dataset.folderPath === selectedCwd);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
      const targetPath = items[nextIdx].dataset.folderPath;
      const targetFolder = getAllFolders().find((f) => f.path === targetPath);
      if (targetFolder) selectFolder(targetFolder);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
      const targetPath = items[prevIdx].dataset.folderPath;
      const targetFolder = getAllFolders().find((f) => f.path === targetPath);
      if (targetFolder) selectFolder(targetFolder);
    } else if (e.key === 'Enter') {
      // Ensure the highlighted or first item is selected before form submit executes
      const targetItem = currentIdx >= 0 ? items[currentIdx] : items[0];
      if (targetItem) {
        const targetFolder = getAllFolders().find((f) => f.path === targetItem.dataset.folderPath);
        if (targetFolder) selectFolder(targetFolder);
      }
    }
  });

  createSessionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    let cwd = newSessionCwdInput.value.trim();

    // If search is active and current cwd isn't the first match, default to first match
    const firstItem = pickerFolderList.querySelector('.picker-item');
    if (firstItem && pickerSearchInput.value.trim() && (!cwd || !selectedCwd || selectedCwd !== firstItem.dataset.folderPath)) {
      const all = getAllFolders();
      const matched = all.find((f) => f.path === firstItem.dataset.folderPath);
      if (matched) {
        selectFolder(matched);
        cwd = matched.path;
      }
    }

    const folderBase = (selectedCwd || cwd).split('/').filter(Boolean).pop() || 'session';
    const name = (newSessionNameInput && newSessionNameInput.value.trim()) || computeUniqueSessionName(folderBase);
    const command = (newSessionCommandInput && newSessionCommandInput.value.trim()) || 'agy';

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
