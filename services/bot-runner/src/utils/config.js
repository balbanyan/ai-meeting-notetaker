require('dotenv').config();

const config = {
  // Webex Configuration
  webex: {
    guestIssuerId: process.env.WEBEX_GUEST_ISSUER_ID,
    guestIssuerSecret: process.env.WEBEX_GUEST_ISSUER_SECRET,
    accessToken: process.env.WEBEX_ACCESS_TOKEN,
  },
  
  // Bot Configuration
  bot: {
    name: process.env.BOT_NAME || 'AI Space Notetaker',
    serviceToken: process.env.BOT_SERVICE_TOKEN,
  },
  
  // Backend API Configuration
  backend: {
    apiUrl: process.env.BACKEND_API_URL || 'http://localhost:8000',
    wsUrl: process.env.BACKEND_WS_URL || 'ws://localhost:8000',
  },
  
  // Audio Configuration
  audio: {
    chunkDurationMs: parseInt(process.env.AUDIO_CHUNK_DURATION_MS) || 8000,
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
    channels: parseInt(process.env.AUDIO_CHANNELS) || 1,
  },
  
  // Meeting Configuration
  meeting: {
    autoJoinDelayMs: parseInt(process.env.AUTO_JOIN_DELAY_MS) || 2000,
    maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS) || 5000,
  },
  
  // Development Configuration
  dev: {
    nodeEnv: process.env.NODE_ENV || 'development',
    enableLogging: process.env.ELECTRON_ENABLE_LOGGING === 'true',
  },
};

// Validate required configuration
function validateConfig() {
  // Check if we have either Guest Issuer credentials OR Access Token
  const hasGuestIssuer = config.webex.guestIssuerId && 
                         config.webex.guestIssuerSecret &&
                         config.webex.guestIssuerId !== 'your-guest-issuer-id-here' &&
                         config.webex.guestIssuerSecret !== 'your-guest-issuer-secret-here';
  
  const hasAccessToken = config.webex.accessToken && 
                         config.webex.accessToken !== 'your-personal-access-token-here';
  
  if (!hasGuestIssuer && !hasAccessToken) {
    throw new Error('Missing Webex authentication: Please provide either Guest Issuer credentials (WEBEX_GUEST_ISSUER_ID + WEBEX_GUEST_ISSUER_SECRET) or Access Token (WEBEX_ACCESS_TOKEN)');
  }
  
  // Check bot service token
  if (!config.bot.serviceToken || config.bot.serviceToken === 'your-bot-service-token-here') {
    throw new Error('Missing or placeholder BOT_SERVICE_TOKEN');
  }
}

module.exports = {
  config,
  validateConfig
};
