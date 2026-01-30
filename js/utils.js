/**
 * Sharp Dashboard - Utility Functions
 */

/**
 * Format timestamp as relative time (e.g., "5m ago")
 */
export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Escape HTML special characters for safe rendering
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  // Also escape single quotes for use in attributes
  return div.innerHTML.replace(/'/g, '&#39;');
}

/**
 * Show a toast notification
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✓' : type === 'warning' ? '⚠' : 'ℹ';
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  
  container.appendChild(toast);
  
  // Auto-remove after duration
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}

/**
 * Debounce function calls
 */
export function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}
