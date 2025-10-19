# Environment Configuration (.env)

Create a file named `.env` in the `services/backend/` directory with the following content:

## Complete .env Template

```bash
# ============================================================================
# AI Meeting Notetaker - Backend Configuration
# ============================================================================
# This file contains all configuration for both the Python backend and the
# embedded Node.js bot-runner.

# ============================================================================
# Database Configuration
# ============================================================================
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker

# ============================================================================
# Bot Service Authentication (shared between backend and bot-runner)
# ============================================================================
BOT_SERVICE_TOKEN=dev-bot-token-12345

# ============================================================================
# Bot Runner Configuration (internal communication)
# ============================================================================
# URL where bot-runner API will be accessible (usually don't change)
BOT_RUNNER_URL=http://localhost:3001

# ============================================================================
# Webex API Configuration
# ============================================================================
# Service App Credentials (for backend to fetch meeting metadata)
WEBEX_CLIENT_ID=your_webex_client_id_here
WEBEX_CLIENT_SECRET=your_webex_client_secret_here
WEBEX_REFRESH_TOKEN=your_webex_refresh_token_here

# Personal Access Token (alternative to OAuth, useful for testing)
# Get from: https://developer.webex.com/docs/getting-started
WEBEX_PERSONAL_ACCESS_TOKEN=your_personal_access_token_here

# Bot Access Token (for bot-runner to join meetings)
# This is your Webex Bot's access token
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token_here

# ============================================================================
# Bot Identity Configuration
# ============================================================================
BOT_DISPLAY_NAME=AI Meeting Notetaker
BOT_EMAIL=ai-notetaker@yourcompany.com

# ============================================================================
# Backend API URL (for bot-runner to send data back to backend)
# ============================================================================
BACKEND_API_URL=http://localhost:8000

# ============================================================================
# Bot Mode
# ============================================================================
# Options: 'headless' or 'gui'
# Always use 'headless' when embedded in backend
BOT_MODE=headless

# ============================================================================
# Transcription Configuration (Groq Whisper API)
# ============================================================================
# Get API key from: https://console.groq.com/keys
WHISPER_GROQ_API=your_groq_api_key_here
WHISPER_MODEL=whisper-large-v3
GROQ_API_BASE_URL=https://api.groq.com/openai/v1
```

## Required Variables

### Minimum Required (to start the backend)
```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker
BOT_SERVICE_TOKEN=dev-bot-token-12345
```

### Required for Bot-Runner to Work
```bash
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token_here
BOT_SERVICE_TOKEN=dev-bot-token-12345  # Must match backend token
```

### Required for Meeting Metadata Fetching
At least one of these sets:

**Option 1: OAuth Flow (recommended for production)**
```bash
WEBEX_CLIENT_ID=your_client_id
WEBEX_CLIENT_SECRET=your_client_secret
WEBEX_REFRESH_TOKEN=your_refresh_token
```

**Option 2: Personal Access Token (easier for testing)**
```bash
WEBEX_PERSONAL_ACCESS_TOKEN=your_personal_token
```

### Required for Transcription
```bash
WHISPER_GROQ_API=your_groq_api_key
```

## Variable Details

### DATABASE_URL
PostgreSQL connection string. Format:
```
postgresql://[user]:[password]@[host]:[port]/[database_name]
```

### BOT_SERVICE_TOKEN
Authentication token for bot-runner to authenticate with backend API. Can be any secure string. **Must be the same** in both places it's used.

### WEBEX_BOT_ACCESS_TOKEN
Your Webex Bot's access token. This is what allows the bot to join meetings.
- Get from Webex Developer Portal when you create a bot
- This is a long-lived token (doesn't expire unless regenerated)

### WEBEX_CLIENT_ID, WEBEX_CLIENT_SECRET, WEBEX_REFRESH_TOKEN
OAuth credentials for your Webex Integration/Service App. Used by backend to:
- Fetch meeting details
- Get participant lists
- Access meeting metadata

### WEBEX_PERSONAL_ACCESS_TOKEN
Alternative to OAuth. Good for testing, expires after 12 hours.
- Get from: https://developer.webex.com/docs/getting-started
- Easier to set up than OAuth
- Not recommended for production

### BOT_DISPLAY_NAME & BOT_EMAIL
The name and email of your bot as it appears in meetings.

### BACKEND_API_URL
Where the bot-runner can reach the backend API. Usually `http://localhost:8000` for local development.

### BOT_MODE
Always set to `headless` when using the embedded bot-runner.

### WHISPER_GROQ_API
API key for Groq's Whisper transcription service.
- Sign up at: https://console.groq.com/
- Get free API key from: https://console.groq.com/keys

## File Location

**Create the .env file here:**
```
services/backend/.env
```

The file will be automatically loaded by:
1. Python backend (via `pydantic-settings`)
2. Node.js bot-runner (via `dotenv`, configured to look in parent directory)

## Security Notes

- **Never commit `.env` to git** (already in .gitignore)
- Keep your tokens secure
- Rotate tokens periodically
- Use different tokens for development and production
- The `BOT_SERVICE_TOKEN` should be a strong random string in production

## Verification

After creating your `.env` file, verify it works:

```bash
cd services/backend
python main.py
```

You should see:
```
🚀 Starting AI Meeting Notetaker...
✅ Database tables created/verified
📦 Bot-runner will start on-demand when first meeting is joined
```

If you see errors about missing configuration, check that all required variables are set.

