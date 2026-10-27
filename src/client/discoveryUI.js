import {
  getSavedServers,
  saveDiscoveredServer,
  getCustomSubnet,
  saveCustomSubnet,
  probeServer,
  runLocalScan,
  cancelScan
} from './discovery.js';
import { showToast } from './toast.js';

// Elements on the Disconnected Overlay
const localScanStatusBox = document.getElementById('local-scan-status-box');
const localScanStatusTitle = document.getElementById('local-scan-status-title');
const localScanStatusSubtitle = document.getElementById('local-scan-status-subtitle');
const localServerFoundBox = document.getElementById('local-server-found-box');
const localServerFoundTitle = document.getElementById('local-server-found-title');
const localServerFoundDesc = document.getElementById('local-server-found-desc');
const btnConnectLocalServer = document.getElementById('btn-connect-local-server');
const btnOpenScanModal = document.getElementById('btn-open-scan-modal');

// Elements in the Scan Network Modal
const scanModalOverlay = document.getElementById('scan-modal-overlay');
const btnCloseScanModal = document.getElementById('btn-close-scan-modal');
const btnDoneScanModal = document.getElementById('btn-done-scan-modal');
const inputDirectIp = document.getElementById('input-direct-ip');
const btnDirectConnect = document.getElementById('btn-direct-connect');
const inputCustomSubnet = document.getElementById('input-custom-subnet');
const btnStartManualScan = document.getElementById('btn-start-manual-scan');
const knownServersList = document.getElementById('known-servers-list');
const btnClearKnownServers = document.getElementById('btn-clear-known-servers');
const modalScanStatusBox = document.getElementById('modal-scan-status-box');
const modalScanStatusText = document.getElementById('modal-scan-status-text');
const btnCancelScan = document.getElementById('btn-cancel-scan');
const btnScanAllCommon = document.getElementById('btn-scan-all-common');

let autoScanTimeout = null;
let currentFoundTarget = null;
let modalOpenedAt = 0;

export function openScanModal() {
  modalOpenedAt = Date.now();
  if (scanModalOverlay) {
    scanModalOverlay.classList.remove('hidden');
    renderKnownServers();
    if (inputCustomSubnet) {
      inputCustomSubnet.value = getCustomSubnet();
    }
  }
}

export function closeScanModal() {
  if (scanModalOverlay) {
    scanModalOverlay.classList.add('hidden');
  }
}

function renderKnownServers() {
  if (!knownServersList) return;
  const servers = getSavedServers();
  if (servers.length === 0) {
    knownServersList.innerHTML = `<div class="p-2.5 rounded-lg bg-[#1b2229] border border-[#3f444a] text-center text-[#5B6268]">No known local servers yet</div>`;
    return;
  }

  knownServersList.innerHTML = servers
    .map(
      (srv) => `
    <div class="flex items-center justify-between p-2 rounded-lg bg-[#1b2229] border border-[#3f444a] hover:border-[#51afef]/50 transition">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-2 h-2 rounded-full bg-[#51afef] shrink-0"></span>
        <span class="font-mono text-xs text-[#DFDFDF] truncate">${srv}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          data-host="${srv}"
          class="btn-probe-server px-2.5 py-1 rounded bg-[#21242b] hover:bg-[#51afef] hover:text-[#1b2229] text-[#DFDFDF] text-[11px] font-bold border border-[#3f444a] transition cursor-pointer"
        >
          Connect
        </button>
      </div>
    </div>
  `
    )
    .join('');

  knownServersList.querySelectorAll('.btn-probe-server').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.host;
      btn.textContent = 'Probing...';
      btn.disabled = true;
      const res = await probeServer(target, 2000);
      if (res) {
        connectToLocalTarget(res.hostPort);
      } else {
        btn.textContent = 'Failed';
        showToast(`Could not reach ${target}`, 'error');
        setTimeout(() => {
          btn.textContent = 'Connect';
          btn.disabled = false;
        }, 1500);
      }
    });
  });
}

/**
 * Navigate to the local server target.
 * @param {string} hostPort e.g. "192.168.1.150:8080"
 */
export function connectToLocalTarget(hostPort) {
  if (!hostPort) return;
  saveDiscoveredServer(hostPort);
  const targetUrl = `http://${hostPort}`;
  showToast(`Connecting to ${hostPort}...`, 'info');
  setTimeout(() => {
    window.location.href = targetUrl;
  }, 300);
}

/**
 * Update UI when a server is discovered.
 */
function handleServerFound(server) {
  currentFoundTarget = server.hostPort;
  if (localScanStatusBox) localScanStatusBox.classList.add('hidden');
  if (modalScanStatusBox) modalScanStatusBox.classList.add('hidden');

  if (localServerFoundBox) {
    localServerFoundBox.classList.remove('hidden');
    if (localServerFoundTitle) {
      localServerFoundTitle.textContent = server.hostname
        ? `Found ${server.hostname} (${server.hostPort})`
        : `Found Local Server (${server.hostPort})`;
    }
    if (localServerFoundDesc) {
      localServerFoundDesc.textContent = `agy-babysitter detected on local network!`;
    }
  }

  showToast(`Found local server at ${server.hostPort}!`, 'success');
  renderKnownServers();
}

/**
 * Trigger an automated scan for local agy-babysitter instances.
 */
export async function triggerAutoScan(options = {}) {
  // If already found, don't re-run
  if (currentFoundTarget) return;

  if (localScanStatusBox) {
    localScanStatusBox.classList.remove('hidden');
    if (localScanStatusTitle) localScanStatusTitle.textContent = 'Scanning local network...';
    if (localScanStatusSubtitle) localScanStatusSubtitle.textContent = 'Checking known & common subnets';
  }
  if (modalScanStatusBox) {
    modalScanStatusBox.classList.remove('hidden');
    if (modalScanStatusText) modalScanStatusText.textContent = 'Scanning local network...';
  }

  const result = await runLocalScan({
    ...options,
    onProgress: (statusText) => {
      if (localScanStatusSubtitle) localScanStatusSubtitle.textContent = statusText;
      if (modalScanStatusText) modalScanStatusText.textContent = statusText;
    }
  });

  if (result) {
    handleServerFound(result);
  } else {
    if (localScanStatusBox) localScanStatusBox.classList.add('hidden');
    if (modalScanStatusBox) modalScanStatusBox.classList.add('hidden');
    if (options.showToastOnFail) {
      showToast('No local agy-babysitter server found', 'error');
    }
  }
}

/**
 * Schedule automated scan ~10s after disconnect or immediately if initial boot failed.
 * @param {boolean} immediate
 */
export function scheduleAutoScan(immediate = false) {
  clearAutoScanTimer();
  if (immediate) {
    triggerAutoScan();
  } else {
    autoScanTimeout = setTimeout(() => {
      triggerAutoScan();
    }, 10000); // 10 seconds after disconnect
  }
}

export function clearAutoScanTimer() {
  if (autoScanTimeout) {
    clearTimeout(autoScanTimeout);
    autoScanTimeout = null;
  }
  cancelScan();
  if (localScanStatusBox) localScanStatusBox.classList.add('hidden');
  if (modalScanStatusBox) modalScanStatusBox.classList.add('hidden');
}

export function resetDiscoveryState() {
  clearAutoScanTimer();
  currentFoundTarget = null;
  if (localServerFoundBox) localServerFoundBox.classList.add('hidden');
  if (localScanStatusBox) localScanStatusBox.classList.add('hidden');
  if (modalScanStatusBox) modalScanStatusBox.classList.add('hidden');
}

export function initDiscoveryUI() {
  if (btnOpenScanModal) {
    btnOpenScanModal.addEventListener('click', () => {
      openScanModal();
    });
  }

  if (btnCloseScanModal) {
    btnCloseScanModal.addEventListener('click', closeScanModal);
  }

  if (btnDoneScanModal) {
    btnDoneScanModal.addEventListener('click', closeScanModal);
  }

  if (scanModalOverlay) {
    scanModalOverlay.addEventListener('click', (e) => {
      if (e.target === scanModalOverlay && Date.now() - modalOpenedAt > 350) {
        closeScanModal();
      }
    });
  }

  if (btnConnectLocalServer) {
    btnConnectLocalServer.addEventListener('click', () => {
      if (currentFoundTarget) {
        connectToLocalTarget(currentFoundTarget);
      }
    });
  }

  if (btnDirectConnect && inputDirectIp) {
    btnDirectConnect.addEventListener('click', async () => {
      const val = inputDirectIp.value.trim();
      if (!val) {
        showToast('Please enter an IP address or hostname', 'error');
        return;
      }
      btnDirectConnect.textContent = 'Probing...';
      btnDirectConnect.disabled = true;
      const res = await probeServer(val, 2500);
      btnDirectConnect.textContent = 'Connect';
      btnDirectConnect.disabled = false;
      if (res) {
        connectToLocalTarget(res.hostPort);
      } else {
        showToast(`Could not reach agy-babysitter at ${val}`, 'error');
      }
    });

    inputDirectIp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnDirectConnect.click();
      }
    });
  }

  if (btnStartManualScan && inputCustomSubnet) {
    btnStartManualScan.addEventListener('click', () => {
      const val = inputCustomSubnet.value.trim().replace(/\.\*$/, '').replace(/\.$/, '');
      if (!val) {
        showToast('Please enter a subnet prefix (e.g. 192.168.1)', 'error');
        return;
      }
      saveCustomSubnet(val);
      triggerAutoScan({ subnets: [val], showToastOnFail: true });
    });
  }

  if (btnScanAllCommon) {
    btnScanAllCommon.addEventListener('click', () => {
      triggerAutoScan({ showToastOnFail: true });
    });
  }

  if (btnCancelScan) {
    btnCancelScan.addEventListener('click', () => {
      cancelScan();
      if (modalScanStatusBox) modalScanStatusBox.classList.add('hidden');
      if (localScanStatusBox) localScanStatusBox.classList.add('hidden');
      showToast('Scan cancelled', 'info');
    });
  }

  if (btnClearKnownServers) {
    btnClearKnownServers.addEventListener('click', () => {
      try {
        localStorage.removeItem('agy_known_local_servers');
      } catch (e) {}
      renderKnownServers();
      showToast('History cleared', 'info');
    });
  }
}
