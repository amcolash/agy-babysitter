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

export function parseQuotaPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') return null;

  const modelId = (rawPayload.model?.id || '').toLowerCase();
  const is3p = /claude|anthropic|3p/.test(modelId);
  const q5hKey = is3p ? '3p-5h' : 'gemini-5h';
  const qwkKey = is3p ? '3p-weekly' : 'gemini-weekly';

  const quotas = rawPayload.quota || rawPayload.quotas || {};
  const q5h = quotas[q5hKey] || quotas['5h'] || quotas['gemini-5h'] || quotas['3p-5h'] || null;
  const qwk = quotas[qwkKey] || quotas['weekly'] || quotas['gemini-weekly'] || quotas['3p-weekly'] || null;

  const result = {
    model: rawPayload.model?.display_name || rawPayload.modelName || 'agy',
    modelId: rawPayload.model?.id || '',
    contextWindowUsed: rawPayload.context_window?.used_percentage ?? null,
    dailyLeft: null,
    quota7d: null,
    quota5h: null,
    updatedAt: Date.now()
  };

  // Process 5h quota (if available)
  if (q5h && typeof q5h.remaining_fraction === 'number') {
    const usedPct = Math.max(0, Math.min(100, (1 - q5h.remaining_fraction) * 100));
    result.quota5h = {
      usedPercentage: parseFloat(usedPct.toFixed(2)),
      remainingFraction: q5h.remaining_fraction,
      resetTime: q5h.reset_time || null,
      resetRelative: formatRelativeTime(q5h.reset_time)
    };
  }

  // Process weekly quota (Quota 7d)
  if (qwk && typeof qwk.remaining_fraction === 'number') {
    const usedPct = Math.max(0, Math.min(100, (1 - qwk.remaining_fraction) * 100));
    result.quota7d = {
      usedPercentage: parseFloat(usedPct.toFixed(2)),
      remainingFraction: qwk.remaining_fraction,
      resetTime: qwk.reset_time || null,
      resetRelative: formatRelativeTime(qwk.reset_time)
    };

    // Calculate Daily Left: 100% = 1 full day of baseline allowance (1/7th weekly quota)
    if (qwk.reset_time && qwk.reset_time !== 'null') {
      const resetEpoch = Math.floor(new Date(qwk.reset_time).getTime() / 1000);
      if (!isNaN(resetEpoch)) {
        const nowEpoch = Math.floor(Date.now() / 1000);
        let diff = resetEpoch - nowEpoch;
        if (diff < 0) diff = 0;
        if (diff > 604800) diff = 604800;

        const elapsed = 604800 - diff;
        let dayNum = Math.floor(elapsed / 86400) + 1;
        if (dayNum > 7) dayNum = 7;
        if (dayNum < 1) dayNum = 1;

        const usedFraction = 1 - qwk.remaining_fraction;
        const usedDays = usedFraction * 7;
        let dailyLeftDays = dayNum - usedDays;
        const totalRemDays = qwk.remaining_fraction * 7;
        if (dailyLeftDays > totalRemDays) dailyLeftDays = totalRemDays;

        const dailyPct = dailyLeftDays * 100;
        result.dailyLeft = {
          percentage: parseFloat(dailyPct.toFixed(2)),
          remainingDays: parseFloat(dailyLeftDays.toFixed(2))
        };
      }
    }
  }

  return result;
}

export function saveQuota(payload) {
  const parsed = parseQuotaPayload(payload);
  if (!parsed) return null;

  cachedQuota = parsed;

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
  parseQuotaPayload,
  saveQuota,
  getQuota,
  onQuotaChange,
  formatRelativeTime
};
