/**
 * Shared Utilities Index
 * Exports all utility functions for easy importing
 */

const { generateUUID } = require('./uuid');
const { createLogger, createBrowserLogger, createElectronLogger, testBackend } = require('./logger');
const { analyzeAudioChunk, testAudioStreamActivity, calculateTargetSamples } = require('./audio-analysis');
const { createOrRecreateAudioElement, showStatus, cleanupAudioContext, cleanupAudioElement } = require('./dom-helpers');

module.exports = {
  // UUID utilities
  generateUUID,
  
  // Logging utilities
  createLogger,
  createBrowserLogger,
  createElectronLogger,
  
  // Audio analysis utilities
  analyzeAudioChunk,
  testAudioStreamActivity,
  calculateTargetSamples,
  
  // DOM helper utilities
  createOrRecreateAudioElement,
  showStatus,
  cleanupAudioContext,
  cleanupAudioElement,
  
  // Backend utilities
  testBackend
};
