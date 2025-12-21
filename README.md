# AI Meeting Notetaker

An AI-powered meeting notetaker for Webex meetings that runs as an embedded app inside Webex meetings. Automatically captures and processes meeting audio using multistream technology with speaker separation.

## 🚀 Features

- **Webex Embedded App**: Seamlessly integrated into Webex meetings interface
- **One-Click Bot Join**: Launch AI notetaker bot directly from within the meeting
- **Multistream Audio Capture**: Individual speaker audio streams with automatic separation
- **Real-time Speaker Events**: Track who's speaking with timestamps
- **AI-Powered Transcription**: Converts speech to text using advanced Whisper models
- **Screenshare Capture** (Optional): Automatically captures screenshots of shared screens with AI vision analysis
- **Persistent Data Storage**: Stores audio chunks, speaker events, transcripts, and screenshots
- **On-Demand Bot Runner**: Bot-runner starts automatically when needed

## 🏗️ Architecture

### Services
- **Frontend** (`services/frontend`): React/Vite embedded app running inside Webex meetings
  - Webex SDK integration for meeting context
  - One-click bot trigger interface
  - Dev mode for local testing
  
- **Backend** (`services/backend`): FastAPI + PostgreSQL for API endpoints and data storage
  - Meeting registration and metadata management
  - Audio chunk and speaker event storage
  - Groq Whisper transcription service integration
  - On-demand bot-runner process management
  
- **Bot-runner** (`services/backend/bot-runner`): Node.js headless bot with Puppeteer
  - Multistream audio capture from Webex meetings
  - Speaker-separated audio processing
  - Sequential chunk processing with backend integration
  - Automatic cleanup and error recovery

### Embedded App Workflow
1. User opens embedded app inside Webex meeting
2. User clicks "Join Bot" button in embedded app UI
3. Embedded app sends meeting ID to backend
4. Backend fetches complete meeting metadata from Webex APIs
5. Backend triggers bot-runner (auto-starts if not running)
6. Bot joins meeting via multistream, captures speaker-separated audio
7. Audio chunks and speaker events saved to database
8. Automatic transcription via Groq Whisper API

### Transcription Service
- **Groq Whisper API**: Automatic speech-to-text transcription
- **Background Processing**: Asynchronous transcription of audio chunks
- **Multi-language Support**: Auto-detection enabled

## 🛠️ Technology Stack

**Frontend (Embedded App):**
- React + Vite for fast development and hot reload
- Webex Embedded Apps Framework SDK
- Modern UI with beautiful loading states

**Backend:**
- FastAPI, SQLAlchemy, PostgreSQL, Pydantic
- RESTful API with meeting registration and audio processing
- Webex Meetings API integration (Admin, List, Invitees)
- Groq Whisper API integration for transcription
- On-demand subprocess management for bot-runner

**Bot Runner:**
- Puppeteer + Webex Browser SDK for headless meeting join
- Multistream audio capture with speaker separation
- Real-time audio processing and chunking
- Backend API integration for data storage

**Audio Processing:**
- Webex multistream audio capture (separate tracks per speaker)
- 16kHz sample rate with 10-second chunking
- WAV format conversion and analysis
- Speaker event tracking with timestamps

**Transcription:**
- Groq Whisper large-v3 model
- Background processing with FastAPI BackgroundTasks
- Automatic language detection

## 📋 Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **PostgreSQL** running on localhost:5432
- **Webex Bot Token** with appropriate scopes
- **Webex Integration Credentials** (Client ID, Client Secret, Refresh Token)
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

**Backend Environment:**
```bash
cd services/backend
cp .env.example .env

# Edit .env with your credentials:
# Database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker

# Webex Bot
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token

# Webex Integration (for Admin API access)
WEBEX_CLIENT_ID=your_client_id
WEBEX_CLIENT_SECRET=your_client_secret
WEBEX_REFRESH_TOKEN=your_refresh_token
WEBEX_PERSONAL_ACCESS_TOKEN=your_personal_access_token

# Transcription
WHISPER_GROQ_API=your_groq_api_key

# Bot Runner
BOT_RUNNER_URL=http://localhost:3001
BOT_SERVICE_TOKEN=your_secure_token

# Screenshot Capture (Optional)
ENABLE_SCREENSHOTS=false
VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

**Frontend Environment:**
```bash
cd ../frontend
cp .env.example .env

# Edit .env with your settings:
VITE_DEV_MODE=false  # Set to 'true' for local testing without Webex SDK

# Note: VITE_BACKEND_URL is no longer needed - frontend uses relative URLs
# Nginx handles routing to backend automatically
```

**Bot-Runner Environment:**
```bash
cd ../backend/bot-runner
cp .env.example .env

# Edit .env with your credentials:
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token
BOT_DISPLAY_NAME="AI Meeting Notetaker"
BACKEND_API_URL=http://localhost:8080
BOT_SERVICE_TOKEN=your_secure_token

# Screenshot Capture (Optional)
ENABLE_SCREENSHOTS=false
```

### 3. Install Dependencies
```bash
# Backend dependencies
cd services/backend
python -m venv .venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt

# Bot runner dependencies (Node.js)
cd bot-runner
npm install
cd ../../..

# Frontend dependencies
cd services/frontend
npm install
cd ../..
```

### 4. Start Services

**Quick Start (Recommended):**
```bash
# Start backend (bot-runner starts automatically on first meeting join)
./start.sh
```

**Manual Start:**
```bash
# Terminal 1 - Backend API
cd services/backend
source .venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload

# Terminal 2 - Frontend (for development)
cd services/frontend
npm run dev
```

**Verify Services:**
```bash
# Check backend health
curl http://localhost:8080/health

# Check API docs
open http://localhost:8080/docs

# Check frontend (dev mode)
open http://localhost:5173
```

## 🎯 Usage

### Production Mode (Embedded App in Webex Meeting)

1. **Deploy Embedded App** to Webex App Hub
2. **Start Backend Service** with production configuration
3. **Join a Webex Meeting** where the embedded app is installed
4. **Open the Embedded App** from the apps panel in the meeting
5. **Click "Join Bot"** to trigger the AI notetaker
6. Bot automatically joins and starts capturing audio
7. Audio chunks and speaker events are stored in the database
8. Transcription happens automatically in the background

### Development Mode (Local Testing)

**Option 1: Dev Mode (No Webex SDK)**
1. Start backend: `./start.sh`
2. Start frontend: `cd services/frontend && npm run dev`
3. Open `http://localhost:5173?VITE_DEV_MODE=true`
4. Enter a meeting ID manually to test API integration

**Option 2: Testing Endpoint**
```bash
# Test bot join without Webex API calls
curl -X POST http://localhost:8080/api/meetings/test-join \
  -H "Content-Type: application/json" \
  -d '{"meeting_url": "https://meet.webex.com/meet/your-meeting"}'
```

### API Endpoints

**Backend (Port 8080):**
- `GET /health` - Health check (at root, no /api prefix)
- `GET /metrics` - Prometheus metrics (at root, no /api prefix)
- `POST /api/meetings/register-and-join` - Register meeting and trigger bot (production)
- `POST /api/meetings/test-join` - Test bot join without API calls (development)
- `PATCH /api/meetings/{uuid}/status` - Update meeting status
- `POST /api/audio/chunk` - Submit audio chunks from bot
- `GET /api/audio/chunks/{meeting_uuid}` - Get all chunks for meeting
- `GET /api/audio/chunks/count` - Get chunk count
- `POST /api/events/speaker-started` - Log speaker event
- `POST /api/screenshots/capture` - Submit screenshot from bot
- `WS /ws/meeting/{meeting_id}` - WebSocket for real-time updates (no /api prefix)

**Bot Runner (Port 3001, started on-demand):**
- `POST /join` - Join a meeting (triggered by backend)
- `GET /status` - Get bot status and active meetings

## 🗃️ Database Schema

**meetings table:**
- `id` (UUID, PK) - Internal meeting UUID
- `webex_meeting_id` (String) - Webex meeting ID
- `meeting_number` (String) - Webex meeting number
- `meeting_link` (String) - Meeting web link
- `host_email` (String) - Meeting host email
- `invitees_emails` (Array) - List of invited emails before meeting
- `participants_emails` (Array) - List of actual participants who joined
- `is_active` (Boolean) - Currently active status
- `scheduled_start_time` (Timestamp) - Scheduled start time
- `scheduled_end_time` (Timestamp) - Scheduled end time
- `actual_join_time` (Timestamp) - When bot joined
- `actual_leave_time` (Timestamp) - When bot left
- `created_at` (Timestamp) - Record creation time

**audio_chunks table:**
- `id` (UUID, PK) - Unique identifier
- `meeting_uuid` (UUID, FK) - References meetings table
- `chunk_id` (Integer) - Sequential chunk number
- `chunk_audio` (BYTEA) - WAV audio data
- `chunk_transcript` (String, nullable) - Transcript text
- `transcription_status` (String) - 'ready', 'processing', 'completed', 'failed'
- `speaker_id` (String, nullable) - Webex participant ID
- `speaker_name` (String, nullable) - Speaker display name
- `created_at` (Timestamp) - When chunk was created
- `updated_at` (Timestamp) - Last modification time

**speaker_events table:**
- `id` (UUID, PK) - Unique identifier
- `meeting_uuid` (UUID, FK) - References meetings table
- `speaker_id` (String) - Webex participant ID
- `speaker_name` (String) - Speaker display name
- `event_type` (String) - 'started', 'stopped'
- `timestamp` (Timestamp) - When event occurred
- `created_at` (Timestamp) - Record creation time

## 🔧 Configuration

### Environment Variables

**Backend (.env):**
```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker

# Webex Bot
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token

# Webex Integration (Admin API)
WEBEX_CLIENT_ID=your_client_id
WEBEX_CLIENT_SECRET=your_client_secret
WEBEX_REFRESH_TOKEN=your_refresh_token
WEBEX_PERSONAL_ACCESS_TOKEN=your_personal_token

# Transcription
WHISPER_GROQ_API=your_groq_api_key
WHISPER_MODEL=whisper-large-v3
GROQ_API_BASE_URL=https://api.groq.com/openai/v1

# Bot Runner
BOT_RUNNER_URL=http://localhost:3001
BOT_SERVICE_TOKEN=your_secure_token

# Screenshot Capture (Optional)
ENABLE_SCREENSHOTS=false
VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

**Frontend (.env):**
```bash
VITE_DEV_MODE=false  # Set to 'true' for local testing without Webex SDK

# Note: VITE_BACKEND_URL is no longer needed - frontend uses relative URLs
# Nginx handles routing to backend automatically
```

**Bot-Runner (.env):**
```bash
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token
BOT_DISPLAY_NAME="AI Meeting Notetaker"
BACKEND_API_URL=http://localhost:8080
BOT_SERVICE_TOKEN=your_secure_token

# Screenshot Capture (Optional)
ENABLE_SCREENSHOTS=false
```

### Audio Configuration
- **Sample Rate**: 16kHz (optimal for transcription)
- **Chunk Duration**: 10 seconds
- **Format**: WAV (uncompressed)
- **Channels**: Mono (per speaker with multistream)
- **Multistream**: Enabled for speaker separation

### Project Structure
```
ai-meeting-notetaker/
├── services/
│   ├── frontend/         # React embedded app
│   │   ├── src/
│   │   │   ├── App.jsx   # Main embedded app UI
│   │   │   └── api/      # Backend API client
│   │   └── package.json
│   └── backend/          # FastAPI backend
│       ├── app/
│       │   ├── api/      # API endpoints
│       │   │   ├── meetings.py      # Meeting registration
│       │   │   ├── audio.py         # Audio chunk processing
│       │   │   ├── speaker_events.py # Speaker event logging
│       │   │   └── health.py        # Health check
│       │   ├── core/     # Config, database, auth
│       │   ├── models/   # SQLAlchemy models
│       │   ├── services/ # Webex API, transcription
│       │   └── bot_runner/ # On-demand subprocess manager
│       ├── bot-runner/   # Node.js headless bot
│       │   └── src/
│       │       ├── headless/        # Puppeteer bot
│       │       │   ├── manager.js             # Express server
│       │       │   └── webex-client-multistream.js # Webex client
│       │       └── lib/               # Audio processing, API client
│       ├── main.py       # Entry point
│       └── requirements.txt
├── markdown-instructions/ # Documentation
├── start.sh              # Quick start script
└── README.md
```

### Key Files
- `services/frontend/src/App.jsx` - Embedded app UI with Webex SDK integration
- `services/backend/app/api/meetings.py` - Meeting registration and bot trigger
- `services/backend/app/services/webex_api.py` - Webex API client (Admin, List, Invitees)
- `services/backend/app/bot_runner/manager.py` - On-demand bot-runner subprocess manager
- `services/backend/bot-runner/src/headless/webex-client-multistream.js` - Multistream audio capture
- `services/backend/bot-runner/src/lib/audio/processor.js` - Audio processing and chunking
- `services/backend/main.py` - FastAPI entry point with auto-tables

---
