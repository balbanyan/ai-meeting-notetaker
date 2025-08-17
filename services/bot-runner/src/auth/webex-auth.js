const { init: initWebex } = require('webex');
const { buildJwt, isJwtExpiring } = require('./jwt');
const { createLogger } = require('../utils/logger');

const logger = createLogger('WebexAuth');

class WebexAuth {
  constructor() {
    this.webex = null;
    this.currentJwt = null;
    this.isAuthenticated = false;
  }

  /**
   * Initialize and authenticate the Webex SDK
   */
  async initialize() {
    try {
      logger.info('Initializing Webex SDK...');
      
      // Step 1: Initialize Webex SDK
      logger.info('Creating Webex SDK instance...');
      this.webex = initWebex();
      
      if (!this.webex) {
        throw new Error('Failed to create Webex SDK instance');
      }
      
      logger.info('Webex SDK instance created successfully');
      
      // Step 2: Generate JWT and authenticate
      logger.info('Starting authentication process...');
      await this.authenticate();
      
      // Step 3: Verify authentication worked
      logger.info('Verifying authentication...');
      if (!this.isAuthenticated || !this.webex) {
        throw new Error('Authentication verification failed');
      }
      
      logger.info('✅ Webex SDK initialized and authenticated successfully');
      return this.webex;
      
    } catch (error) {
      this.isAuthenticated = false;
      this.webex = null;
      logger.error('❌ Failed to initialize Webex SDK:', error);
      
      // Provide more specific error information
      if (error.message.includes('JWT')) {
        logger.error('💡 JWT generation or validation failed - check Guest Issuer credentials');
      } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
        logger.error('💡 Network error - check internet connection and DNS resolution');
      } else if (error.message.includes('authorization') || error.message.includes('access')) {
        logger.error('💡 Authorization failed - verify Guest Issuer ID and Secret are correct');
      }
      
      throw error;
    }
  }

  /**
   * Authenticate using Guest Issuer JWT
   */
  async authenticate() {
    try {
      const { config } = require('../utils/config');
      logger.info('Authenticating with Webex using Guest Issuer...');
      
      // Build JWT token
      this.currentJwt = buildJwt();
      logger.debug('JWT built successfully');
      
      // Authenticate with Webex using JWT
      await this.webex.authorization.requestAccessTokenFromJwt({
        jwt: this.currentJwt,
      });
      
      this.isAuthenticated = true;
      logger.info('Webex Guest Issuer authentication successful');
      
    } catch (error) {
      this.isAuthenticated = false;
      logger.error('Webex Guest Issuer authentication failed:', error);
      throw error;
    }
  }

  /**
   * Refresh authentication if JWT is expiring
   */
  async refreshIfNeeded() {
    if (!this.currentJwt || isJwtExpiring(this.currentJwt)) {
      logger.info('JWT is expiring, refreshing authentication...');
      await this.authenticate();
    }
  }

  /**
   * Get the authenticated Webex instance
   */
  getWebex() {
    if (!this.isAuthenticated || !this.webex) {
      throw new Error('Webex SDK not authenticated. Call initialize() first.');
    }
    return this.webex;
  }

  /**
   * Check if currently authenticated
   */
  isAuth() {
    return this.isAuthenticated && this.webex;
  }
}

// Singleton instance
let webexAuthInstance = null;

function getWebexAuth() {
  if (!webexAuthInstance) {
    webexAuthInstance = new WebexAuth();
  }
  return webexAuthInstance;
}

module.exports = {
  WebexAuth,
  getWebexAuth
};
