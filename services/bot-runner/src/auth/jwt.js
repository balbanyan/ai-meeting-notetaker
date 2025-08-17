const crypto = require('crypto-js');
const { config } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('JWT');

/**
 * Build JWT token for Webex Guest Issuer authentication
 * Based on the Webex SDK guide: https://developer.webex.com/blog/how-to-build-meeting-bots-for-webex
 */
function buildJwt() {
  try {
    const payload = {
      sub: "webex-bot-1",
      name: config.bot.name,
      iss: config.webex.guestIssuerId,
      // 1h expiry time
      exp: (Math.floor(new Date().getTime() / 1000) + 60 * 60).toString(),
    };

    logger.debug('Building JWT with payload:', payload);

    const encodedHeader = crypto.enc.Base64url.stringify(
      crypto.enc.Utf8.parse(JSON.stringify({
        typ: "JWT",
        alg: "HS256",
      }))
    );
    
    const encodedPayload = crypto.enc.Base64url.stringify(
      crypto.enc.Utf8.parse(JSON.stringify(payload))
    );
    
    const encodedData = `${encodedHeader}.${encodedPayload}`;
    
    const signature = crypto.HmacSHA256(
      encodedData,
      crypto.enc.Base64.parse(config.webex.guestIssuerSecret)
    ).toString(crypto.enc.Base64url);

    const jwt = `${encodedData}.${signature}`;
    
    logger.info('JWT generated successfully');
    return jwt;
    
  } catch (error) {
    logger.error('Failed to build JWT:', error);
    throw error;
  }
}

/**
 * Check if JWT is expired or expiring soon
 */
function isJwtExpiring(jwt, bufferMinutes = 5) {
  try {
    const payload = JSON.parse(
      crypto.enc.Base64url.parse(jwt.split('.')[1]).toString(crypto.enc.Utf8)
    );
    
    const expiryTime = parseInt(payload.exp) * 1000;
    const bufferTime = bufferMinutes * 60 * 1000;
    const currentTime = Date.now();
    
    return (expiryTime - currentTime) <= bufferTime;
  } catch (error) {
    logger.error('Failed to check JWT expiry:', error);
    return true; // Assume expired if we can't parse
  }
}

module.exports = {
  buildJwt,
  isJwtExpiring
};
