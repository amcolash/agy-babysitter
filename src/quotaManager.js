import fs from 'fs';
import path from 'path';
import os from 'os';

const QUOTA_CACHE_FILE = path.join(os.homedir(), '.config', 'agy-babysitter', 'quota.json');

let cachedQuota = null;
const quotaListeners = new Set();

export function formatRelativeTime(resetIso) {
  if (!resetIso || resetIso === 'null') return '';
  const targetEpoch = Math.floor(new Date(resetIso).getTime() / 1000);
  if (isNaN(targetEpoch)) return '';
  const nowEpoch = Math.floor(Date.now() / 1000);
  const diff = targetEpoch - nowEpoch;

  if (diff <= 0) return 'now';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
  }
  if (hours > 0) {
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }
  if (mins > 0) {
    return `in ${mins}m`;
  }
  return 'in <1m';
}

export function saveQuota(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // Ignore raw unparsed hook payloads that do not contain pre-computed statusline fields
  if (!('dailyLeft' in payload) && !('quota7d' in payload) && !('quota5h' in payload)) {
    return cachedQuota;
  }

  const current = cachedQuota || getQuota() || {};

  const nextQuota = {
    model: payload.model || current.model || 'agy',
    modelId: payload.modelId ?? current.modelId ?? '',
    contextWindowUsed: payload.contextWindowUsed ?? current.contextWindowUsed ?? null,
    dailyLeft: payload.dailyLeft ?? current.dailyLeft ?? null,
    quota7d: payload.quota7d ?? current.quota7d ?? null,
    quota5h: payload.quota5h ?? current.quota5h ?? null,
    updatedAt: Date.now()
  };

  cachedQuota = nextQuota;

  try {
    const dir = path.dirname(QUOTA_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUOTA_CACHE_FILE, JSON.stringify(cachedQuota, null, 2), 'utf-8');
  } catch (e) {}

  for (const listener of quotaListeners) {
    try {
      listener(cachedQuota);
    } catch (e) {}
  }

  return cachedQuota;
}

export function getQuota() {
  if (cachedQuota) {
    if (cachedQuota.quota5h?.resetTime) {
      cachedQuota.quota5h.resetRelative = formatRelativeTime(cachedQuota.quota5h.resetTime);
    }
    if (cachedQuota.quota7d?.resetTime) {
      cachedQuota.quota7d.resetRelative = formatRelativeTime(cachedQuota.quota7d.resetTime);
    }
    return cachedQuota;
  }
  try {
    if (fs.existsSync(QUOTA_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUOTA_CACHE_FILE, 'utf-8'));
      if (data.quota5h?.resetTime) {
        data.quota5h.resetRelative = formatRelativeTime(data.quota5h.resetTime);
      }
      if (data.quota7d?.resetTime) {
        data.quota7d.resetRelative = formatRelativeTime(data.quota7d.resetTime);
      }
      cachedQuota = data;
      return cachedQuota;
    }
  } catch (e) {}
  return null;
}

export function onQuotaChange(listener) {
  quotaListeners.add(listener);
  return () => quotaListeners.delete(listener);
}

export default {
  saveQuota,
  getQuota,
  onQuotaChange,
  formatRelativeTime
};
