require('dotenv').config();

const config = {
  // Webex Configuration
  webex: {
    guestIssuerId: process.env.WEBEX_GUEST_ISSUER_ID,
    guestIssuerSecret: process.env.WEBEX_GUEST_ISSUER_SECRET,
  },
  
  // Bot Configuration
  bot: {
    name: process.env.BOT_NAME || 'AI Space Notetaker',
    displayName: process.env.BOT_DISPLAY_NAME || 'AI Meeting Notetaker',
    email: process.env.BOT_EMAIL || 'ai-notetaker@yourcompany.com',
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
    announcementEnabled: process.env.ANNOUNCEMENT_ENABLED === 'true',
    announcementText: process.env.ANNOUNCEMENT_TEXT || 'Hello! I\'m the AI Meeting Notetaker. I\'ll be transcribing this meeting for participants.',
  },
  
  // Development Configuration
  dev: {
    nodeEnv: process.env.NODE_ENV || 'development',
    enableLogging: process.env.ELECTRON_ENABLE_LOGGING === 'true',
  },
};

// Validate required configuration
function validateConfig() {
  // Check if we have Guest Issuer credentials
  const hasGuestIssuer = config.webex.guestIssuerId && 
                         config.webex.guestIssuerSecret &&
                         config.webex.guestIssuerId !== 'your-guest-issuer-id-here' &&
                         config.webex.guestIssuerSecret !== 'your-guest-issuer-secret-here';
  
  if (!hasGuestIssuer) {
    throw new Error('Missing Webex Guest Issuer credentials: Please provide WEBEX_GUEST_ISSUER_ID and WEBEX_GUEST_ISSUER_SECRET');
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
