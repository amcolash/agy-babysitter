/**
 * Local Server Discovery Module for agy-babysitter
 * Scans saved IPs, mDNS hostnames, and common/custom subnets to find local servers
 * when the remote cloud tunnel is unreachable.
 */

const STORAGE_KEY_KNOWN_SERVERS = 'agy_known_local_servers';
const STORAGE_KEY_CUSTOM_SUBNET = 'agy_custom_subnet';

// Common subnets across home routers, Airbnbs, coffee shops, and mobile hotspots
const DEFAULT_SUBNETS = [
  '192.168.1',   // Common default (Asus, Netgear, Linksys, etc.)
  '192.168.0',   // Common default (TP-Link, D-Link, etc.)
  '192.168.86',  // Google Nest / Google Wifi
  '192.168.4',   // Eero mesh
  '10.0.0',      // Xfinity / Comcast gateway
  '172.20.10'    // iOS personal hotspot
];

const SCAN_PORT = 8080;
const PING_TIMEOUT_MS = 1400;
const BATCH_SIZE = 25;

let isScanningActive = false;
let abortScanController = null;

/**
 * Get previously saved local servers from localStorage.
 * Returns an array of strings like ["192.168.1.150:8080", "cachyos-x8664.local:8080"]
 * @returns {string[]}
 */
export function getSavedServers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_KNOWN_SERVERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * Remember a discovered local server in localStorage.
 * @param {string} hostPort e.g. "192.168.1.150:8080"
 */
export function saveDiscoveredServer(hostPort) {
  if (!hostPort) return;
  const servers = getSavedServers().filter((s) => s !== hostPort);
  servers.unshift(hostPort); // Most recent first
  // Keep up to 10 known servers
  try {
    localStorage.setItem(STORAGE_KEY_KNOWN_SERVERS, JSON.stringify(servers.slice(0, 10)));
  } catch (e) {}
}

/**
 * Get user-saved custom subnet if any.
 * @returns {string}
 */
export function getCustomSubnet() {
  try {
    return localStorage.getItem(STORAGE_KEY_CUSTOM_SUBNET) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Save user custom subnet.
 * @param {string} subnet
 */
export function saveCustomSubnet(subnet) {
  try {
    if (subnet) {
      localStorage.setItem(STORAGE_KEY_CUSTOM_SUBNET, subnet.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY_CUSTOM_SUBNET);
    }
  } catch (e) {}
}

/**
 * Probes an address (host:port) to verify if it is an agy-babysitter server.
 * Uses both fetch and Image probe fallback to bypass mixed content or PNA rules where supported.
 * @param {string} hostPort
 * @param {number} [timeoutMs]
 * @returns {Promise<{ hostPort: string, hostname?: string, app?: string } | null>}
 */
export async function probeServer(hostPort, timeoutMs = PING_TIMEOUT_MS) {
  const normalized = hostPort.includes(':') ? hostPort : `${hostPort}:${SCAN_PORT}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Method 1: Try fetch JSON with CORS / Private Network Access headers
  try {
    const res = await fetch(`http://${normalized}/api/discovery`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.app === 'agy-babysitter') {
        saveDiscoveredServer(normalized);
        return { hostPort: normalized, hostname: data.hostname, app: data.app };
      }
    }
  } catch (e) {
    // If fetch failed (e.g. mixed content blocked fetch or connection refused)
  }

  // Method 2: Try Image probe (often succeeds across mixed-content boundaries in mobile WebKit/Chromium)
  return new Promise((resolve) => {
    let resolved = false;
    const imgTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeoutMs);

    const img = new Image();
    img.onload = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(imgTimer);
        saveDiscoveredServer(normalized);
        resolve({ hostPort: normalized, hostname: null, app: 'agy-babysitter' });
      }
    };
    img.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(imgTimer);
        resolve(null);
      }
    };
    img.src = `http://${normalized}/api/discovery.png?_t=${Date.now()}`;
  });
}

/**
 * Stop any currently running background scan.
 */
export function cancelScan() {
  if (abortScanController) {
    abortScanController.abort();
    abortScanController = null;
  }
  isScanningActive = false;
}

/**
 * Scans a range of IPs or addresses with progress callbacks.
 * First checks known servers, then mDNS hostname candidates, then the specified subnets.
 *
 * @param {Object} options
 * @param {string[]} [options.subnets] Subnet prefixes, e.g. ['192.168.1']
 * @param {string[]} [options.directTargets] Specific hosts or IPs to probe first
 * @param {(statusText: string, currentTarget?: string) => void} [options.onProgress]
 * @returns {Promise<{ hostPort: string, hostname?: string } | null>}
 */
export async function runLocalScan(options = {}) {
  if (isScanningActive) {
    cancelScan();
  }

  isScanningActive = true;
  abortScanController = new AbortController();
  const { signal } = abortScanController;

  const onProgress = options.onProgress || (() => {});

  try {
    // Phase 1: Check known servers from localStorage and direct targets
    const directTargets = [
      ...(options.directTargets || []),
      ...getSavedServers(),
      'cachyos-x8664.local:8080' // System hostname mDNS candidate
    ];

    const uniqueTargets = [...new Set(directTargets.filter(Boolean))];

    for (const target of uniqueTargets) {
      if (signal.aborted) return null;
      onProgress(`Checking saved server: ${target}...`, target);
      const res = await probeServer(target, 1000);
      if (res) {
        isScanningActive = false;
        return res;
      }
    }

    // Phase 2: Determine subnets to scan
    let subnetsToScan = options.subnets && options.subnets.length > 0 ? options.subnets : [];
    if (subnetsToScan.length === 0) {
      const custom = getCustomSubnet();
      if (custom) {
        subnetsToScan = [custom, ...DEFAULT_SUBNETS.filter((s) => s !== custom)];
      } else {
        subnetsToScan = DEFAULT_SUBNETS;
      }
    }

    // Phase 3: Scan subnets in parallel batches
    for (const subnet of subnetsToScan) {
      if (signal.aborted) return null;
      onProgress(`Scanning ${subnet}.* network...`, `${subnet}.*`);

      // Generate all 254 IP addresses for this /24 subnet (.1 to .254)
      const ipList = [];
      for (let i = 1; i <= 254; i++) {
        ipList.push(`${subnet}.${i}:${SCAN_PORT}`);
      }

      // Scan in concurrent batches
      for (let i = 0; i < ipList.length; i += BATCH_SIZE) {
        if (signal.aborted) return null;
        const batch = ipList.slice(i, i + BATCH_SIZE);
        onProgress(`Scanning ${subnet}.${i + 1}-${Math.min(i + BATCH_SIZE, 254)}...`);

        const probePromises = batch.map((target) => probeServer(target, PING_TIMEOUT_MS));
        const results = await Promise.all(probePromises);

        const found = results.find(Boolean);
        if (found) {
          isScanningActive = false;
          return found;
        }
      }
    }

    isScanningActive = false;
    return null;
  } catch (err) {
    isScanningActive = false;
    return null;
  }
}
