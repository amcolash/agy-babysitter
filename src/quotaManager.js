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
    result.dailyLeft = calculateDailyLeft(qwk);
  }

  return result;
}

export function calculateDailyLeft(qwk, atTimestamp = Date.now()) {
  const remainingFraction = qwk?.remaining_fraction ?? qwk?.remainingFraction;
  const resetTime = qwk?.reset_time ?? qwk?.resetTime;

  if (typeof remainingFraction !== 'number' || !resetTime || resetTime === 'null') {
    return null;
  }
  const resetDate = new Date(resetTime);
  if (isNaN(resetDate.getTime())) return null;

  // start_dt = reset_dt - timedelta(days=7)
  const startDate = new Date(resetDate.getTime() - 7 * 86400 * 1000);
  const nowDate = new Date(atTimestamp);

  // Difference in calendar dates in the local timezone (resets at midnight in local time)
  const startLocalMidnight = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const nowLocalMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const diffDays = Math.round((nowLocalMidnight.getTime() - startLocalMidnight.getTime()) / 86400000);

  let dayNum = diffDays + 1;
  if (dayNum > 7) dayNum = 7;
  if (dayNum < 1) dayNum = 1;

  const usedFraction = 1.0 - remainingFraction;
  const usedDays = usedFraction * 7.0;

  let dailyLeftDays = dayNum - usedDays;
  const totalRemDays = remainingFraction * 7.0;
  if (dailyLeftDays > totalRemDays) {
    dailyLeftDays = totalRemDays;
  }

  const dailyPct = dailyLeftDays * 100.0;
  return {
    percentage: parseFloat(dailyPct.toFixed(2)),
    remainingDays: parseFloat(dailyLeftDays.toFixed(2)),
    dayNum
  };
}

export function mergeQuota(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;

  const is3pPool = (id) => /claude|anthropic|3p/.test((id || '').toLowerCase());
  const currentIs3p = is3pPool(current.modelId);
  const incomingIs3p = is3pPool(incoming.modelId);

  // If switching between different model pools (Gemini vs Claude), accept incoming
  if (currentIs3p !== incomingIs3p) {
    return incoming;
  }

  const result = {
    model: incoming.model || current.model,
    modelId: incoming.modelId || current.modelId,
    contextWindowUsed: incoming.contextWindowUsed ?? current.contextWindowUsed,
    dailyLeft: null,
    quota7d: null,
    quota5h: null,
    updatedAt: Date.now()
  };

  // 1. Quota 7d: Monotonically decrease remaining (or increase used) unless reset window changed/refreshed
  if (current.quota7d && incoming.quota7d) {
    const currentReset7d = current.quota7d.resetTime ? new Date(current.quota7d.resetTime).getTime() : NaN;
    const incomingReset7d = incoming.quota7d.resetTime ? new Date(incoming.quota7d.resetTime).getTime() : NaN;

    if (!isNaN(incomingReset7d) && !isNaN(currentReset7d) && incomingReset7d > currentReset7d) {
      // New weekly cycle detected
      result.quota7d = incoming.quota7d;
    } else if (!isNaN(incomingReset7d) && !isNaN(currentReset7d) && incomingReset7d < currentReset7d) {
      // Stale weekly cycle from an older window
      result.quota7d = current.quota7d;
    } else {
      // Same cycle: prevent higher remaining / lower usage
      const remainingFraction = Math.min(current.quota7d.remainingFraction, incoming.quota7d.remainingFraction);
      const usedPct = Math.max(0, Math.min(100, (1 - remainingFraction) * 100));
      result.quota7d = {
        usedPercentage: parseFloat(usedPct.toFixed(2)),
        remainingFraction,
        resetTime: current.quota7d.resetTime || incoming.quota7d.resetTime,
        resetRelative: formatRelativeTime(current.quota7d.resetTime || incoming.quota7d.resetTime)
      };
    }
  } else {
    result.quota7d = incoming.quota7d || current.quota7d;
  }

  // 2. Daily Left: derived directly from Quota 7d
  // Since result.quota7d.remainingFraction already enforces monotonic usage within the cycle,
  // dailyLeft accurately mirrors local calendar date allowance without getting stuck on stale min bounds.
  if (result.quota7d) {
    const recomputedDaily = calculateDailyLeft(
      {
        remaining_fraction: result.quota7d.remainingFraction,
        reset_time: result.quota7d.resetTime
      },
      Date.now()
    );
    result.dailyLeft = recomputedDaily || incoming.dailyLeft || current.dailyLeft;
  } else {
    result.dailyLeft = incoming.dailyLeft || current.dailyLeft;
  }

  // 3. Quota 5h: Monotonically decrease remaining unless 5h reset window advanced
  if (current.quota5h && incoming.quota5h) {
    const currentReset5h = current.quota5h.resetTime ? new Date(current.quota5h.resetTime).getTime() : NaN;
    const incomingReset5h = incoming.quota5h.resetTime ? new Date(incoming.quota5h.resetTime).getTime() : NaN;

    if (!isNaN(incomingReset5h) && !isNaN(currentReset5h) && incomingReset5h > currentReset5h) {
      // 5h window rolled over into the future
      result.quota5h = incoming.quota5h;
    } else if (!isNaN(incomingReset5h) && !isNaN(currentReset5h) && incomingReset5h < currentReset5h) {
      // Stale 5h window
      result.quota5h = current.quota5h;
    } else {
      // Same 5h window
      const remainingFraction = Math.min(current.quota5h.remainingFraction, incoming.quota5h.remainingFraction);
      const usedPct = Math.max(0, Math.min(100, (1 - remainingFraction) * 100));
      result.quota5h = {
        usedPercentage: parseFloat(usedPct.toFixed(2)),
        remainingFraction,
        resetTime: current.quota5h.resetTime || incoming.quota5h.resetTime,
        resetRelative: formatRelativeTime(current.quota5h.resetTime || incoming.quota5h.resetTime)
      };
    }
  } else {
    result.quota5h = incoming.quota5h || current.quota5h;
  }

  return result;
}

export function saveQuota(payload) {
  const incoming = parseQuotaPayload(payload);
  if (!incoming) return null;

  const current = cachedQuota || getQuota();
  const merged = mergeQuota(current, incoming);

  cachedQuota = merged;

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
      cachedQuota.dailyLeft = calculateDailyLeft({
        remaining_fraction: cachedQuota.quota7d.remainingFraction,
        reset_time: cachedQuota.quota7d.resetTime
      });
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
        data.dailyLeft = calculateDailyLeft({
          remaining_fraction: data.quota7d.remainingFraction,
          reset_time: data.quota7d.resetTime
        });
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
  calculateDailyLeft,
  mergeQuota,
  saveQuota,
  getQuota,
  onQuotaChange,
  formatRelativeTime
};
