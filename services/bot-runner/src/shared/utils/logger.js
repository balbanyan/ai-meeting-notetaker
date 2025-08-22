/**
 * Logging Utilities
 * Centralized logging functions for consistent output across components
 */

/**
 * Create a logger function with timestamp
 * @param {string} context - Optional context prefix for logs
 * @returns {Function} Logger function
 */
function createLogger(context = '') {
  return (message, level = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = context ? `[${context}]` : '';
    console.log(`[${timestamp}]${prefix} ${message}`);
  };
}

/**
 * Create browser-compatible addLog function for page evaluation
 * @returns {Function} Browser logger function with timestamp
 */
function createBrowserLogger() {
  return function addLog(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
  };
}

/**
 * Create Electron-compatible addLog function for renderer
 * @param {HTMLElement} logsContainer - Container element for log entries
 * @returns {Function} Electron logger function with DOM updates
 */
function createElectronLogger(logsContainer) {
  return function addLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
    
    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
  };
}

/**
 * Test backend connection with logging
 * @param {Object} backendClient - Backend client instance
 * @param {Function} logger - Logger function
 * @returns {Promise<boolean>} Connection success status
 */
async function testBackend(backendClient, logger) {
  try {
    logger('🔍 Testing backend connection...', 'info');
    const success = await backendClient.testConnection();
    
    if (success) {
      logger('✅ Backend connection successful', 'success');
      return true;
    } else {
      logger('❌ Backend connection failed', 'error');
      return false;
    }
  } catch (error) {
    logger(`❌ Backend test failed: ${error.message}`, 'error');
    return false;
  }
}

module.exports = {
  createLogger,
  createBrowserLogger,
  createElectronLogger,
  testBackend
};
