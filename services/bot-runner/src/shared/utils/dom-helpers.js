/**
 * DOM Helper Utilities
 * Common DOM manipulation functions for browser environments
 */

/**
 * Create or recreate an audio element with proper cleanup
 * @param {string} elementId - ID of the audio element
 * @param {Object} options - Audio element options
 * @returns {HTMLAudioElement} Created or existing audio element
 */
function createOrRecreateAudioElement(elementId, options = {}) {
  let audioElement = document.getElementById(elementId);
  
  // Remove if previously connected to avoid MediaElementSource errors
  if (audioElement && audioElement._wasConnectedToSource) {
    audioElement.remove();
    audioElement = null;
  }
  
  if (!audioElement) {
    audioElement = document.createElement('audio');
    audioElement.id = elementId;
    audioElement.autoplay = options.autoplay !== false;
    audioElement.style.display = options.visible ? 'block' : 'none';
    
    // Append to specified parent or body
    const parent = options.parent ? document.getElementById(options.parent) : document.body;
    parent.appendChild(audioElement);
  }
  
  return audioElement;
}

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

/**
 * Clean up audio context and related resources
 * @param {AudioContext} audioContext - Audio context to clean up
 * @param {Object} options - Cleanup options
 */
function cleanupAudioContext(audioContext, options = {}) {
  if (audioContext && audioContext.state !== 'closed') {
    try {
      audioContext.close();
      if (options.logSuccess) {
        console.log('✅ Audio context cleaned up');
      }
    } catch (error) {
      if (options.logError) {
        console.error('❌ Error cleaning up audio context:', error);
      }
    }
  }
}

/**
 * Clean up audio element and its source
 * @param {string} elementId - ID of the audio element to clean up
 * @param {Object} options - Cleanup options
 */
function cleanupAudioElement(elementId, options = {}) {
  const audioElement = document.getElementById(elementId);
  if (audioElement) {
    audioElement.srcObject = null;
    audioElement._wasConnectedToSource = false;
    
    if (options.remove) {
      audioElement.remove();
    }
    
    if (options.logSuccess) {
      console.log(`✅ Audio element ${elementId} cleaned up`);
    }
  }
}

module.exports = {
  createOrRecreateAudioElement,
  showStatus,
  cleanupAudioContext,
  cleanupAudioElement
};
