const CryptoJS = require('crypto-js');
const { config } = require('./config');

/**
 * Generate JWT token following official Webex documentation exactly
 */
function generateJWT() {
  const payload = {
    sub: config.bot.email,
    name: config.bot.displayName,
    iss: config.webex.guestIssuerId,
    // 1h expiry time (as string like in docs)
    exp: (Math.floor(new Date().getTime() / 1000) + 60 * 60).toString(),
  };

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
    CryptoJS.enc.Base64.parse(config.webex.guestIssuerSecret)
  ).toString(CryptoJS.enc.Base64url);

  return `${encodedData}.${signature}`;
}

module.exports = { generateJWT };
