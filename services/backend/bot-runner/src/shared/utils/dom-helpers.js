/**
 * DOM Helper Utilities
 * Common DOM manipulation functions for browser environments
 */

/**
 * Show status message in a status element
 * @param {string} message - Message to display
 * @param {string} type - Status type (info, success, error, warning)
 * @param {Object} options - Display options
 */
function showStatus(message, type = 'info', options = {}) {
  const statusEl = document.getElementById(options.elementId || 'status');
  if (!statusEl) return;
  
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
  
  // Auto-hide after specified time for non-error messages
  const autoHideMs = options.autoHideMs || 5000;
  if (type !== 'error' && autoHideMs > 0) {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, autoHideMs);
  }
}

module.exports = {
  showStatus
};
