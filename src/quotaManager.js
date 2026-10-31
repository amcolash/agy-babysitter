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

export function isSameOrLaterCalendarDay(dateA, dateB) {
  // dateA >= dateB in calendar day
  const midnightA = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate()).getTime();
  const midnightB = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate()).getTime();
  return midnightA > midnightB;
}

export function mergeQuota(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;

  const is3pPool = (id) => /claude|anthropic|3p/.test((id || '').toLowerCase());
  const currentIs3p = is3pPool(current.modelId || current.model);
  const incomingIs3p = is3pPool(incoming.modelId || incoming.model);

  // If switching between different model pools (Gemini vs Claude), accept incoming
  if (currentIs3p !== incomingIs3p) {
    return incoming;
  }

  const result = {
    model: incoming.model || current.model || 'agy',
    modelId: incoming.modelId ?? current.modelId ?? '',
    contextWindowUsed: incoming.contextWindowUsed ?? current.contextWindowUsed ?? null,
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
      const currRem = current.quota7d.remainingFraction ?? (1 - (current.quota7d.usedPercentage ?? 0) / 100);
      const incRem = incoming.quota7d.remainingFraction ?? (1 - (incoming.quota7d.usedPercentage ?? 0) / 100);
      const remainingFraction = Math.min(currRem, incRem);
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

  // 2. Daily Left: Only allow larger quota after reset periods (new calendar day or weekly cycle roll)
  if (current.dailyLeft && incoming.dailyLeft) {
    const currentReset7d = current.quota7d?.resetTime ? new Date(current.quota7d.resetTime).getTime() : NaN;
    const incomingReset7d = incoming.quota7d?.resetTime ? new Date(incoming.quota7d.resetTime).getTime() : NaN;
    const weeklyRefreshed = !isNaN(incomingReset7d) && !isNaN(currentReset7d) && incomingReset7d > currentReset7d;

    const lastUpdated = current.updatedAt ? new Date(current.updatedAt) : new Date(0);
    const now = new Date();
    const isNewDay = isSameOrLaterCalendarDay(now, lastUpdated);

    if (weeklyRefreshed || isNewDay) {
      result.dailyLeft = incoming.dailyLeft;
    } else {
      // Within the same day and weekly cycle: quota can only decrease (or stay same)
      const currPct = typeof current.dailyLeft.percentage === 'number' ? current.dailyLeft.percentage : 100;
      const incPct = typeof incoming.dailyLeft.percentage === 'number' ? incoming.dailyLeft.percentage : 100;
      const minPct = Math.min(currPct, incPct);

      const currRemDays = typeof current.dailyLeft.remainingDays === 'number' ? current.dailyLeft.remainingDays : 1;
      const incRemDays = typeof incoming.dailyLeft.remainingDays === 'number' ? incoming.dailyLeft.remainingDays : 1;
      const minRemDays = Math.min(currRemDays, incRemDays);

      result.dailyLeft = {
        ...incoming.dailyLeft,
        percentage: parseFloat(minPct.toFixed(2)),
        remainingDays: parseFloat(minRemDays.toFixed(2))
      };
    }
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
      // Same 5h window: prevent higher remaining / lower usage
      const currRem = current.quota5h.remainingFraction ?? (1 - (current.quota5h.usedPercentage ?? 0) / 100);
      const incRem = incoming.quota5h.remainingFraction ?? (1 - (incoming.quota5h.usedPercentage ?? 0) / 100);
      const remainingFraction = Math.min(currRem, incRem);
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
  if (!payload || typeof payload !== 'object') return null;

  // Ignore raw unparsed hook payloads that do not contain pre-computed statusline fields
  if (!('dailyLeft' in payload) && !('quota7d' in payload) && !('quota5h' in payload)) {
    return cachedQuota;
  }

  const current = cachedQuota || getQuota();
  const nextQuota = mergeQuota(current, payload);

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
  mergeQuota,
  saveQuota,
  getQuota,
  onQuotaChange,
  formatRelativeTime
};
