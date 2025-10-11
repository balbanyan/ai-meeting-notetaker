/**
 * Shared Utilities Index
 * Exports all utility functions for easy importing
 */

const { createLogger, createElectronLogger, testBackend } = require('./logger');
const { showStatus } = require('./dom-helpers');

module.exports = {
  // Logging utilities
  createLogger,
  createElectronLogger,
  testBackend,
  
  // DOM helper utilities
  showStatus
};
