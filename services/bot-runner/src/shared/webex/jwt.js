/**
 * JWT Generator for Webex Guest Issuer authentication
 * Updated version from working renderer implementation
 */
class JWTGenerator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Build JWT token following official Webex documentation exactly
   * @returns {string} JWT token
   */
  buildJWT() {
    try {
      // For Electron renderer context, use window.require, for Node.js use require
      const CryptoJS = (typeof window !== 'undefined') ? 
        window.require('crypto-js') : 
        require('crypto-js');
      
      const payload = {
        sub: this.config.bot.email,
        name: this.config.bot.displayName,
        iss: this.config.webex.guestIssuerId,
        // 1h expiry time (as string like in docs)
        exp: (Math.floor(new Date().getTime() / 1000) + 60 * 60).toString(),
      };

      // Log payload for debugging (use addLog if available, otherwise console)
      const logMessage = `JWT payload: ${JSON.stringify(payload, null, 2)}`;
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(logMessage, 'info');
      } else {
        console.log(logMessage);
      }

      // Following the exact pattern from Webex docs
      const encodedHeader = CryptoJS.enc.Base64url.stringify(
        CryptoJS.enc.Utf8.parse(JSON.stringify({
          typ: "JWT",
          alg: "HS256",
        }))
      );
      
      const encodedPayload = CryptoJS.enc.Base64url.stringify(
        CryptoJS.enc.Utf8.parse(JSON.stringify(payload))
      );
      
      const encodedData = `${encodedHeader}.${encodedPayload}`;
      
      const signature = CryptoJS.HmacSHA256(
        encodedData,
        CryptoJS.enc.Base64.parse(this.config.webex.guestIssuerSecret)
      ).toString(CryptoJS.enc.Base64url);

      const jwt = `${encodedData}.${signature}`;
      
      // Log success (use addLog if available, otherwise console)
      const successMessage = `✅ JWT generated successfully (${jwt.length} chars)`;
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(successMessage, 'success');
      } else {
        console.log(successMessage);
      }
      
      return jwt;
      
    } catch (error) {
      // Log error (use addLog if available, otherwise console)
      const errorMessage = `❌ JWT generation failed: ${error.message}`;
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(errorMessage, 'error');
      } else {
        console.error(errorMessage);
      }
      throw error;
    }
  }
}

module.exports = { JWTGenerator };
