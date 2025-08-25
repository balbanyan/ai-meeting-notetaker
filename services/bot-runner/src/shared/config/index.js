require('dotenv').config();

const config = {
  // Webex Configuration
  webex: {
    botAccessToken: process.env.WEBEX_BOT_ACCESS_TOKEN,
    apiBaseUrl: process.env.WEBEX_API_BASE_URL || 'https://webexapis.com/v1',
  },
  
  // Bot Configuration
  bot: {
    displayName: process.env.BOT_DISPLAY_NAME || 'AI Meeting Notetaker',
    email: process.env.BOT_EMAIL || 'ai-notetaker@yourcompany.com',
    serviceToken: process.env.BOT_SERVICE_TOKEN,
  },
  
  // Backend Configuration
  backend: {
    apiUrl: process.env.BACKEND_API_URL || 'http://localhost:8000',
  },
  
  // Audio Configuration (10-second chunks)
  audio: {
    chunkDurationMs: 10000, // 10 seconds
    sampleRate: 16000,
    channels: 1,
  },
  
  // Runtime Mode Configuration
  mode: {
    // BOT_MODE: 'gui' | 'headless' - determines if GUI or headless mode
    type: process.env.BOT_MODE || 'gui',
    enableLogging: process.env.ENABLE_LOGGING === 'true',
  },
};

// Validate required configuration
function validateConfig() {
  const required = [
    'webex.botAccessToken',
    'bot.serviceToken'
  ];
  
  for (const key of required) {
    const value = key.split('.').reduce((obj, k) => obj?.[k], config);
    if (!value) {
      throw new Error(`Missing required configuration: ${key}`);
    }
  }
  
  console.log('✅ Configuration validated successfully (using Bot Access Token)');
}

module.exports = { config, validateConfig };
