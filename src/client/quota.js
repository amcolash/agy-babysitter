let currentQuota = null;

// Desktop top-bar elements
const quotaWidgetsHeader = document.getElementById('quota-widgets-header');
const quotaDailyWidget = document.getElementById('quota-daily-widget');
const quotaDailyBar = document.getElementById('quota-daily-bar');
const quotaDailyText = document.getElementById('quota-daily-text');

const quota7dWidget = document.getElementById('quota-7d-widget');
const quota7dBar = document.getElementById('quota-7d-bar');
const quota7dText = document.getElementById('quota-7d-text');
const quota7dReset = document.getElementById('quota-7d-reset');

// Mobile drawer elements
const drawerQuotaContainer = document.getElementById('drawer-quota-container');
const drawerQuotaModel = document.getElementById('drawer-quota-model');
const drawerDailyBar = document.getElementById('drawer-daily-bar');
const drawerDailyText = document.getElementById('drawer-daily-text');
const drawer7dBar = document.getElementById('drawer-7d-bar');
const drawer7dText = document.getElementById('drawer-7d-text');

function getDailyColor(pct) {
  if (pct >= 67) return { bg: 'bg-[#98be65]', text: 'text-[#98be65]' };
  if (pct >= 34) return { bg: 'bg-[#ECBE7B]', text: 'text-[#ECBE7B]' };
  return { bg: 'bg-[#ff6c6b]', text: 'text-[#ff6c6b]' };
}

function getQuotaColor(usedPct) {
  if (usedPct <= 50) return { bg: 'bg-[#98be65]', text: 'text-[#98be65]' };
  if (usedPct <= 75) return { bg: 'bg-[#ECBE7B]', text: 'text-[#ECBE7B]' };
  return { bg: 'bg-[#ff6c6b]', text: 'text-[#ff6c6b]' };
}

export function renderQuota(quota) {
  if (!quota) return;
  currentQuota = quota;

  const { dailyLeft, quota7d, quota5h, model } = quota;

  // 1. Render Daily Left
  if (dailyLeft && typeof dailyLeft.percentage === 'number') {
    const dailyPct = dailyLeft.percentage;
    const barPct = Math.max(0, Math.min(100, dailyPct));
    const colors = getDailyColor(dailyPct);

    if (quotaDailyBar) {
      quotaDailyBar.style.width = `${barPct}%`;
      quotaDailyBar.className = `h-full rounded-full transition-all duration-300 ${colors.bg}`;
    }
    if (quotaDailyText) {
      quotaDailyText.textContent = `${dailyPct.toFixed(1)}%`;
      quotaDailyText.className = `text-xs font-bold min-w-[42px] text-right font-mono ${colors.text}`;
    }
    if (quotaDailyWidget) {
      quotaDailyWidget.title = `Daily Left: ${dailyPct.toFixed(2)}% (${dailyLeft.remainingDays || '0'} days baseline allowance remaining today)`;
    }

    if (drawerDailyBar) {
      drawerDailyBar.style.width = `${barPct}%`;
      drawerDailyBar.className = `h-full rounded-full transition-all duration-300 ${colors.bg}`;
    }
    if (drawerDailyText) {
      drawerDailyText.textContent = `${dailyPct.toFixed(1)}%`;
      drawerDailyText.className = `text-xs font-bold font-mono ${colors.text}`;
    }
  }

  // 2. Render Quota 7d
  if (quota7d && typeof quota7d.usedPercentage === 'number') {
    const usedPct = quota7d.usedPercentage;
    const barPct = Math.max(0, Math.min(100, usedPct));
    const colors = getQuotaColor(usedPct);

    if (quota7dBar) {
      quota7dBar.style.width = `${barPct}%`;
      quota7dBar.className = `h-full rounded-full transition-all duration-300 ${colors.bg}`;
    }
    if (quota7dText) {
      quota7dText.textContent = `${usedPct.toFixed(1)}%`;
      quota7dText.className = `text-xs font-bold min-w-[42px] text-right font-mono ${colors.text}`;
    }
    if (quota7dReset) {
      quota7dReset.textContent = quota7d.resetRelative ? `⟳ ${quota7d.resetRelative}` : '';
    }
    if (quota7dWidget) {
      quota7dWidget.title = `Quota 7d: ${usedPct.toFixed(2)}% used${quota7d.resetRelative ? ` (resets ${quota7d.resetRelative})` : ''}`;
    }

    if (drawer7dBar) {
      drawer7dBar.style.width = `${barPct}%`;
      drawer7dBar.className = `h-full rounded-full transition-all duration-300 ${colors.bg}`;
    }
    if (drawer7dText) {
      drawer7dText.textContent = `${usedPct.toFixed(1)}%`;
      drawer7dText.className = `text-xs font-bold font-mono ${colors.text}`;
    }
  }

  // 3. Model display in drawer
  if (drawerQuotaModel && model) {
    drawerQuotaModel.textContent = model;
  }

  // Unhide containers if they have data
  if (quotaWidgetsHeader && (dailyLeft || quota7d)) {
    quotaWidgetsHeader.classList.remove('hidden');
  }
  if (drawerQuotaContainer && (dailyLeft || quota7d)) {
    drawerQuotaContainer.classList.remove('hidden');
  }
}

export function handleServerQuota(quota) {
  renderQuota(quota);
}

function formatRelativeTime(resetIso) {
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

function tickQuotaTimes() {
  if (!currentQuota) return;
  if (currentQuota.quota7d?.resetTime) {
    currentQuota.quota7d.resetRelative = formatRelativeTime(currentQuota.quota7d.resetTime);
  }
  if (currentQuota.quota5h?.resetTime) {
    currentQuota.quota5h.resetRelative = formatRelativeTime(currentQuota.quota5h.resetTime);
  }
  renderQuota(currentQuota);
}

export async function initQuota() {
  try {
    const res = await fetch('/api/quota');
    if (res.ok) {
      const data = await res.json();
      if (data.quota) {
        renderQuota(data.quota);
      }
    }
  } catch (e) {}

  // Periodic refresh for relative countdowns and clock advancement
  setInterval(tickQuotaTimes, 15000);
}

export default {
  initQuota,
  renderQuota,
  handleServerQuota
};
