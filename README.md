# AI Meeting Notetaker V2

An AI-powered meeting notetaker for Webex meetings that automatically captures and processes meeting audio with both GUI and headless operation modes.

## 🚀 Features

- **Dual Mode Operation**: GUI (Electron) and Headless (Puppeteer) bot modes
- **Webex Integration**: Seamlessly join Webex meetings using official Webex Browser SDK
- **Real-time Audio Capture**: High-quality audio recording in 10-second chunks
- **PostgreSQL Storage**: Persistent storage with optimized database schema
- **Host Detection**: Automatically identifies and stores meeting host information
- **Secure Authentication**: JWT-based authentication with Webex Guest Issuer
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
- **Webex Guest Issuer** credentials

## ⚡ Quick Start

### 1. Database Setup
```bash
# Create database
createdb ai_notetaker_v2

# Or using psql
psql -U postgres -c "CREATE DATABASE ai_notetaker_v2;"
```

### 2. Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your credentials:
# - WEBEX_GUEST_ISSUER_ID
# - WEBEX_GUEST_ISSUER_SECRET  
# - BOT_SERVICE_TOKEN
# - BOT_MODE (gui/headless)
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

**Option A: Quick Start (all services)**
```bash
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
npm run start:gui

# OR Terminal 2 - Bot Runner (Headless mode)
cd services/bot-runner
npm run start:headless
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
2. Send API request to join meeting:
```bash
curl -X POST http://localhost:3001/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://example.webex.com/meet/..."}'
```

### API Endpoints

**Backend (Port 8000):**
- `GET /health` - Health check
- `POST /audio/chunk` - Submit audio chunks

**Bot Runner (Port 3001):**
- `POST /join` - Join a meeting (headless mode)
- `POST /leave` - Leave current meeting
- `GET /status` - Get bot status

## 🗃️ Database Schema

**audio_chunks table:**
- `id` (PK) - Unique identifier
- `meeting_id` - Meeting session ID
- `chunk_id` - Individual chunk ID  
- `chunk_audio` (BYTEA) - WAV audio data
- `chunk_transcript` - Transcript text (optional)
- `transcription_status` - Status: 'ready', 'processed', 'failed'
- `host_email` - Meeting host email
- `created_at` - Timestamp

## 🔧 Configuration

### Environment Variables
```bash
# Webex Configuration
WEBEX_GUEST_ISSUER_ID=your_guest_issuer_id
WEBEX_GUEST_ISSUER_SECRET=your_guest_issuer_secret

# Bot Configuration  
BOT_SERVICE_TOKEN=your_secure_bot_token
BOT_DISPLAY_NAME="AI Meeting Notetaker"
BOT_EMAIL=ai-notetaker@yourcompany.com

# Operation Mode
BOT_MODE=gui  # or 'headless'

# Backend Configuration
BACKEND_URL=http://localhost:8000
```

### Audio Configuration
- **Sample Rate**: 48kHz (optimal for Webex)
- **Chunk Duration**: 10 seconds
- **Format**: WAV (uncompressed)
- **Channels**: Mono

## 🚀 Deployment

### Production Headless Setup
1. Set `BOT_MODE=headless` in environment
2. Deploy backend and bot-runner services
3. Use API endpoints to control meeting participation
4. Monitor logs for audio capture status

### Docker Support
```bash
# Build and run with Docker Compose
docker-compose up -d
```

## 🐛 Troubleshooting

**Common Issues:**

1. **"Device not registered" error**
   - Ensure using `webex.meetings.register()` not `webex.internal.device.register()`

2. **Empty audio chunks**
   - Verify using official Webex SDK audio capture pattern
   - Check microphone permissions in browser/Electron

3. **JWT authentication failed**
   - Verify Guest Issuer credentials are correct
   - Check JWT expiration time

4. **Database connection failed**
   - Ensure PostgreSQL is running on port 5432
   - Verify database name and credentials

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
- `services/bot-runner/src/electron/renderer.js` - Main Electron renderer
- `services/bot-runner/src/headless/webex-client.js` - Main headless client
- `services/bot-runner/src/shared/webex/jwt.js` - JWT authentication
- `services/backend/main.py` - Backend API entry point

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test both GUI and headless modes
5. Submit a pull request

---

**Built with ❤️ for seamless meeting transcription**