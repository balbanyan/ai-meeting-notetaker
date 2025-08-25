# AI Meeting Notetaker V2

An AI-powered meeting notetaker for Webex meetings that automatically captures and processes meeting audio with both GUI and headless operation modes. Designed for production deployment on GCP with automatic browser cleanup.

## 🚀 Features

- **Dual Mode Operation**: GUI (Electron) and Headless (Puppeteer) bot modes
- **Webex Bot Integration**: Direct authentication using Webex Developer Bot access tokens
- **Real-time Audio Capture**: High-quality audio recording in 10-second chunks
- **PostgreSQL Storage**: Persistent storage with optimized database schema and timestamps
- **Auto Browser Cleanup**: Prevents hanging browsers in production
- **Host Detection**: Automatically identifies and stores meeting host information
- **Modern Architecture**: Clean separation of concerns with shared utilities

## 🏗️ Architecture

### Services
- **Backend** (`services/backend`): FastAPI + PostgreSQL for API endpoints and data storage
- **Bot-runner** (`services/bot-runner`): Dual-mode bot with Electron GUI and Puppeteer headless

### Bot Runner Modes
- **GUI Mode**: Electron app with visual interface for development and testing
- **Headless Mode**: Puppeteer automation for production deployment

## 🛠️ Technology Stack

**Backend:**
- FastAPI, SQLAlchemy, PostgreSQL, Pydantic
- RESTful API with health checks and audio chunk endpoints

**Bot Runner:**
- **GUI**: Electron + Webex Browser SDK + Web Audio API
- **Headless**: Puppeteer + Webex Browser SDK + Audio capture
- **Shared**: JWT authentication, audio processing, backend communication

**Audio Processing:**
- Official Webex SDK audio capture patterns
- 48kHz sample rate with 10-second chunking
- WAV format conversion and analysis

## 📋 Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **PostgreSQL** running on localhost:5432
- **Webex Developer Bot** with access token

## ⚡ Quick Start

### 1. Database Setup
```bash
# Create database
createdb ai_notetaker_v2

# Or using psql
psql -U postgres -c "CREATE DATABASE ai_notetaker_v2;"
```

### 2. Environment Configuration

**Create Bot-Runner Environment:**
```bash
cd services/bot-runner
cp .env.example .env

# Edit .env with your credentials:
# - WEBEX_BOT_ACCESS_TOKEN=your_webex_bot_access_token
# - BOT_SERVICE_TOKEN=your_secure_token
# - BOT_MODE=gui  # or 'headless'
```

**Create Backend Environment:**
```bash
cd ../backend
cp .env.example .env

# Edit .env with your credentials:
# - DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker_v2
# - BOT_SERVICE_TOKEN=your_secure_token
# - BOT_RUNNER_URL=http://localhost:3001
```

### 3. Install Dependencies
```bash
# Backend dependencies
cd services/backend
python -m venv .venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
cd ../..

# Bot runner dependencies  
cd services/bot-runner
npm install
cd ../..
```

### 4. Start Services

**Option A: Quick Start Script**
```bash
# Start backend only
./start.sh backend

# Start GUI mode bot and backed
./start.sh gui

# Start headless mode bot and backend
./start.sh headless

# Start all services
./start.sh
```

**Option B: Manual Start**
```bash
# Terminal 1 - Backend API
cd services/backend
source .venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 - Bot Runner (GUI mode)
cd services/bot-runner  
BOT_MODE=gui npm start

# OR Terminal 2 - Bot Runner (Headless mode)
cd services/bot-runner
BOT_MODE=headless npm start
```

**Verify Services:**
```bash
# Check backend health
curl http://localhost:8000/health

# Check headless bot status (if running)
curl http://localhost:3001/status
```

## 🎯 Usage

### GUI Mode (Development)
1. Start both backend and bot-runner in GUI mode
2. Open the Electron app
3. Enter a Webex meeting URL
4. Click "Join Meeting"
5. Audio chunks will be captured and sent to the database

### Headless Mode (Production)
1. Start backend and bot-runner in headless mode
2. Join meeting via API:
```bash
# Join a meeting
curl -X POST http://localhost:3001/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": ""}'

# Or via backend API
curl -X POST http://localhost:8000/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"meeting_url": ""}'
```


### API Endpoints

**Backend (Port 8000):**
- `GET /health` - Health check
- `POST /audio/chunk` - Submit audio chunks
- `GET /audio/chunks/{meeting_id}/count` - Get max chunk ID for meeting
- `GET /audio/chunks/{meeting_id}` - Get all chunks for meeting
- `POST /meetings/join` - Join meeting via backend (calls bot-runner)

**Bot Runner (Port 3001):**
- `POST /join` - Join a meeting (headless mode)
- `GET /status` - Get bot status and active meetings

## 🗃️ Database Schema

**audio_chunks table:**
- `id` (UUID, PK) - Unique identifier
- `meeting_id` (String) - Meeting URL/session ID
- `chunk_id` (Integer) - Sequential chunk number (1, 2, 3...)
- `chunk_audio` (BYTEA) - WAV audio data
- `chunk_transcript` (String) - Transcript text (optional)
- `transcription_status` (String) - Status: 'ready', 'processed', 'failed'
- `host_email` (String) - Meeting host email
- `created_at` (Timestamp) - When chunk was created
- `updated_at` (Timestamp) - When chunk was last modified

## 🔧 Configuration

### Environment Variables

**Bot-Runner (.env):**
```bash
# Webex Bot Authentication
WEBEX_BOT_ACCESS_TOKEN=your_webex_bot_access_token_here
WEBEX_API_BASE_URL=https://webexapis.com/v1

# Bot Configuration
BOT_DISPLAY_NAME="AI Meeting Notetaker"
BOT_EMAIL=ai-notetaker@yourcompany.com
BOT_SERVICE_TOKEN=your_secure_backend_auth_token

# Backend Communication
BACKEND_API_URL=http://localhost:8000

# Operation Mode
BOT_MODE=gui  # or 'headless'
```

**Backend (.env):**
```bash
# Database Configuration
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker_v2

# Authentication
BOT_SERVICE_TOKEN=your_secure_backend_auth_token

# Bot Runner Communication
BOT_RUNNER_URL=http://localhost:3001
```

### Audio Configuration
- **Sample Rate**: 48kHz (optimal for Webex)
- **Chunk Duration**: 10 seconds
- **Format**: WAV (uncompressed)
- **Channels**: Mono

## 🚀 Deployment

### GCP Production Setup
1. **Environment**: Set `BOT_MODE=headless`
2. **Resources**: Configure adequate CPU/memory for concurrent meetings
3. **Database**: Use Cloud SQL PostgreSQL
4. **Secrets**: Store bot tokens in Google Secret Manager
5. **Auto-scaling**: Configure based on meeting load
6. **Monitoring**: Set up health checks and logging

**Key GCP Considerations:**
- **Browser Cleanup**: Auto-closes browsers when meetings end (prevents hanging)
- **Multi-Meeting**: Single instance handles multiple concurrent meetings  
- **Resource Limits**: Set memory/CPU limits to prevent runaway processes
- **Health Checks**: Monitor `/health` and `/status` endpoints

### Docker Support
```bash
# Build and run with Docker Compose
docker-compose up -d

# For production with resource limits
docker run -m 2g --cpus="1.5" ai-meeting-notetaker-v2
```

## 🐛 Troubleshooting

**Common Issues:**

1. **"Device not registered" error**
   - Ensure bot token has meeting permissions
   - Verify using `webex.meetings.register()` not `webex.internal.device.register()`

2. **Empty audio chunks**
   - Verify using official Webex SDK audio capture pattern
   - Check microphone permissions in browser/Electron
   - Ensure bot token is valid and not expired

3. **Bot authentication failed**
   - Verify `WEBEX_BOT_ACCESS_TOKEN` is correct
   - Ensure bot has proper scopes for meetings
   - Test bot token with `webex.people.get('me')`

4. **Database connection failed**
   - Ensure PostgreSQL is running on port 5432
   - Verify database name and credentials
   - Run migration if `updated_at` column missing

5. **Browser not closing after meeting**
   - Check media event handling in logs
   - Verify `media:stopped` events are firing
   - Monitor browser cleanup logs

6. **Chunk ID sequence issues**
   - Check if database schema updated to integer `chunk_id`
   - Verify chunk count API endpoint working
   - Clear old UUID-based chunks if migrating

## 📝 Development

### Project Structure
```
ai-meeting-notetaker-v2/
├── services/
│   ├── backend/          # FastAPI backend
│   │   ├── app/          # Application modules
│   │   ├── main.py       # Entry point
│   │   └── requirements.txt
│   └── bot-runner/       # Dual-mode bot
│       ├── src/
│       │   ├── electron/ # GUI mode (Electron)
│       │   ├── headless/ # Headless mode (Puppeteer)
│       │   └── shared/   # Shared utilities
│       └── package.json
├── .env.example          # Environment template
├── start.sh              # Quick start script
└── README.md
```

### Key Files
- `services/bot-runner/src/electron/renderer.js` - Main Electron renderer with auto-close
- `services/bot-runner/src/headless/webex-client.js` - Main headless client with browser cleanup
- `services/bot-runner/src/shared/webex/jwt.js` - JWT utilities (legacy, for bot tokens now)
- `services/bot-runner/src/shared/audio/processor.js` - Audio processing with sequential IDs
- `services/backend/main.py` - Backend API entry point
- `services/backend/app/api/meetings.py` - Meeting join API with bot-runner integration

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test both GUI and headless modes
5. Submit a pull request

---
