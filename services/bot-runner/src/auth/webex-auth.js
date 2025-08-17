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
      
      // Initialize Webex SDK
      this.webex = initWebex();
      
      // Generate JWT and authenticate
      await this.authenticate();
      
      logger.info('Webex SDK initialized and authenticated successfully');
      return this.webex;
      
    } catch (error) {
      logger.error('Failed to initialize Webex SDK:', error);
      throw error;
    }
  }

  /**
   * Authenticate using JWT or Access Token
   */
  async authenticate() {
    try {
      const { config } = require('../utils/config');
      logger.info('Authenticating with Webex...');
      
      // Check if we have Guest Issuer credentials or Access Token
      const hasGuestIssuer = config.webex.guestIssuerId && 
                             config.webex.guestIssuerSecret &&
                             config.webex.guestIssuerId !== 'your-guest-issuer-id-here';
      
      const hasAccessToken = config.webex.accessToken && 
                             config.webex.accessToken !== 'your-personal-access-token-here';
      
      if (hasGuestIssuer) {
        // Use Guest Issuer JWT authentication
        logger.info('Using Guest Issuer JWT authentication');
        this.currentJwt = buildJwt();
        
        await this.webex.authorization.requestAccessTokenFromJwt({
          jwt: this.currentJwt,
        });
        
      } else if (hasAccessToken) {
        // Use personal access token authentication
        logger.info('Using personal access token authentication');
        
        // Set the access token directly
        this.webex.credentials.set({
          access_token: config.webex.accessToken
        });
        
      } else {
        throw new Error('No valid authentication method available');
      }
      
      this.isAuthenticated = true;
      logger.info('Webex authentication successful');
      
    } catch (error) {
      this.isAuthenticated = false;
      logger.error('Webex authentication failed:', error);
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
