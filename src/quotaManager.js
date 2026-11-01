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

export function computeDailyLeft(quota7d, atTimestamp = Date.now()) {
  const remFraction = quota7d?.remainingFraction ?? (1 - (quota7d?.usedPercentage ?? 0) / 100);
  const resetIso = quota7d?.resetTime;
  if (!resetIso || typeof remFraction !== 'number') return null;

  const resetDt = new Date(resetIso);
  if (isNaN(resetDt.getTime())) return null;

  const startDt = new Date(resetDt.getTime() - 7 * 86400 * 1000);
  const nowDt = new Date(atTimestamp);

  const startDate = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
  const resetDate = new Date(resetDt.getFullYear(), resetDt.getMonth(), resetDt.getDate());
  const nowDate = new Date(nowDt.getFullYear(), nowDt.getMonth(), nowDt.getDate());

  let todayAllowance = 1.0;
  let accumBudget = 1.0;

  if (resetDt.getHours() === 0 && resetDt.getMinutes() === 0 && resetDt.getSeconds() === 0) {
    let dayNum = Math.round((nowDate.getTime() - startDate.getTime()) / 86400000) + 1;
    dayNum = Math.max(1, Math.min(7, dayNum));
    todayAllowance = 1.0;
    accumBudget = dayNum;
  } else {
    const startNextMidnight = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate() + 1);
    const day0Allowance = (startNextMidnight.getTime() - startDt.getTime()) / 86400000;

    const resetMidnight = new Date(resetDt.getFullYear(), resetDt.getMonth(), resetDt.getDate());
    const dayLastAllowance = (resetDt.getTime() - resetMidnight.getTime()) / 86400000;

    if (nowDt >= resetDt || nowDate.getTime() >= resetDate.getTime()) {
      todayAllowance = dayLastAllowance;
      accumBudget = 7.0;
    } else if (nowDate.getTime() <= startDate.getTime()) {
      todayAllowance = day0Allowance;
      accumBudget = day0Allowance;
    } else {
      const fullDaysPassed = Math.round((nowDate.getTime() - startDate.getTime()) / 86400000);
      todayAllowance = 1.0;
      accumBudget = Math.min(7.0, day0Allowance + fullDaysPassed * 1.0);
    }
  }

  const usedFraction = 1.0 - remFraction;
  const usedDays = usedFraction * 7.0;
  let dailyLeftDays = accumBudget - usedDays;
  const totalRemDays = remFraction * 7.0;
  if (dailyLeftDays > totalRemDays) {
    dailyLeftDays = totalRemDays;
  }
  const dailyPct = dailyLeftDays * 100.0;

  return {
    percentage: parseFloat(dailyPct.toFixed(2)),
    remainingDays: parseFloat(dailyLeftDays.toFixed(2)),
    todayAllowance: parseFloat(todayAllowance.toFixed(2))
  };
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

  // 2. Daily Left: compute dynamically from quota7d and current local calendar day
  // Since quota7d is monotonic within a cycle, computeDailyLeft will monotonically decrease during
  // each calendar day and naturally step up at midnight when the new calendar day begins.
  if (result.quota7d) {
    const computedDaily = computeDailyLeft(result.quota7d, Date.now());
    result.dailyLeft = computedDaily || incoming.dailyLeft || current.dailyLeft;
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
