/**
 * Lightweight Doom One styled toast notification manager
 */

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4 sm:px-0';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

const typeStyles = {
  info: {
    border: 'border-[#51afef]',
    badge: 'bg-[#51afef]',
    text: 'text-[#DFDFDF]'
  },
  success: {
    border: 'border-[#98be65]',
    badge: 'bg-[#98be65]',
    text: 'text-[#98be65]'
  },
  error: {
    border: 'border-[#ff6c6b]',
    badge: 'bg-[#ff6c6b]',
    text: 'text-[#ff6c6b]'
  },
  warning: {
    border: 'border-[#ECBE7B]',
    badge: 'bg-[#ECBE7B]',
    text: 'text-[#ECBE7B]'
  }
};

/**
 * Display a toast notification
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} [type='info']
 * @param {number} [duration=3000]
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = ensureToastContainer();
  const style = typeStyles[type] || typeStyles.info;

  const toast = document.createElement('div');
  toast.className = `flex items-center gap-2.5 bg-[#21242b] border ${style.border} ${style.text} text-xs md:text-sm px-3.5 py-2.5 rounded-lg shadow-xl shadow-black/60 pointer-events-auto transform transition-all duration-200 opacity-0 translate-y-2 font-mono`;

  toast.innerHTML = `
    <span class="w-2 h-2 rounded-full ${style.badge} flex-shrink-0"></span>
    <span class="flex-1 font-medium break-words">${message}</span>
  `;

  container.appendChild(toast);

  // Trigger smooth fade & slide in
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-2');
    toast.classList.add('opacity-100', 'translate-y-0');
  });

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 200);
  }, duration);
}
