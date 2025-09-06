# AI Meeting Notetaker

An AI-powered meeting notetaker for Webex meetings that automatically captures and processes meeting audio with both GUI and headless operation modes. Designed for production deployment on GCP with automatic browser cleanup.

## 🚀 Features

- **Automated Meeting Participation**: Joins Webex meetings and captures audio automatically
- **Real-time Audio Processing**: Records and processes meeting audio in structured chunks
- **AI-Powered Transcription**: Converts speech to text using advanced Whisper models
- **Flexible Deployment**: Supports both GUI development mode and headless production deployment
- **Persistent Data Storage**: Stores audio chunks and transcripts with meeting metadata
- **Production Ready**: Auto-cleanup, error handling, and scalable architecture

## 🏗️ Architecture

### Services
- **Backend** (`services/backend`): FastAPI + PostgreSQL for API endpoints and data storage
  - Audio chunk storage and retrieval
  - Groq Whisper transcription service integration
  - Meeting management API
- **Bot-runner** (`services/bot-runner`): Dual-mode bot with Electron GUI and Puppeteer headless
  - Real-time audio capture from Webex meetings
  - Sequential chunk processing with backend integration

### Bot Runner Modes
- **GUI Mode**: Electron app with visual interface for development and testing
- **Headless Mode**: Puppeteer automation for production deployment

### Transcription Service
- **Groq Whisper API**: Automatic speech-to-text transcription
- **Background Processing**: Asynchronous transcription of audio chunks
- **Multi-language Support**: Auto-detection enabled

## 🛠️ Technology Stack

**Backend:**
- FastAPI, SQLAlchemy, PostgreSQL, Pydantic
- RESTful API with health checks and audio chunk endpoints
- Groq Whisper API integration for transcription

**Bot Runner:**
- **GUI**: Electron + Webex Browser SDK + Web Audio API
- **Headless**: Puppeteer + Webex Browser SDK + Audio capture
- **Shared**: Bot token authentication, audio processing, backend communication

**Audio Processing:**
- Official Webex SDK audio capture patterns
- 16kHz sample rate with 10-second chunking
- WAV format conversion and analysis

**Transcription:**
- Groq Whisper large-v3 model
- Background processing with FastAPI BackgroundTasks
- Automatic language detection

## 📋 Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **PostgreSQL** running on localhost:5432
- **Webex Developer Bot** with access token
- **Groq API Key** for transcription

## ⚡ Quick Start

### 1. Database Setup
```bash
# Create database
createdb ai_notetaker

# Or using psql
psql -U postgres -c "CREATE DATABASE ai_notetaker;"
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
# - DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker
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
./start.sh --backend

# Start GUI mode bot and backed
./start.sh --gui

# Start headless mode bot and backend
./start.sh --headless

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
- `transcription_status` (String) - Status: 'ready', 'processing', 'completed', 'failed'
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
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker

# Authentication
BOT_SERVICE_TOKEN=your_secure_backend_auth_token

# Bot Runner Communication
BOT_RUNNER_URL=http://localhost:3001

# Transcription Configuration
WHISPER_GROQ_API=your_groq_api_key_here
WHISPER_MODEL=whisper-large-v3
GROQ_API_BASE_URL=https://api.groq.com/openai/v1
```

### Audio Configuration
- **Sample Rate**: 16kHz (optimal for transcription)
- **Chunk Duration**: 10 seconds
- **Format**: WAV (uncompressed)
- **Channels**: Mono


### Project Structure
```
ai-meeting-notetaker/
├── services/
│   ├── backend/          # FastAPI backend
│   │   ├── app/
│   │   │   ├── api/      # API endpoints (audio, meetings, health)
│   │   │   ├── core/     # Config, database, auth
│   │   │   ├── models/   # SQLAlchemy models
│   │   │   └── services/ # Transcription service (Groq Whisper)
│   │   ├── main.py       # Entry point
│   │   └── requirements.txt
│   └── bot-runner/       # Dual-mode bot
│       ├── src/
│       │   ├── electron/ # GUI mode (Electron)
│       │   ├── headless/ # Headless mode (Puppeteer)
│       │   └── shared/   # Shared utilities (audio, config, API)
│       └── package.json
├── .env.example          # Environment template
├── start.sh              # Quick start script
└── README.md
```

### Key Files
- `services/bot-runner/src/electron/renderer.js` - Main Electron renderer with auto-close
- `services/bot-runner/src/headless/webex-client.js` - Main headless client with browser cleanup
- `services/bot-runner/src/shared/audio/processor.js` - Audio processing with sequential IDs
- `services/backend/main.py` - Backend API entry point
- `services/backend/app/api/meetings.py` - Meeting join API with bot-runner integration
- `services/backend/app/services/transcription.py` - Groq Whisper transcription service


---
