# AI Meeting Notetaker

An AI-powered meeting notetaker for Webex that automatically joins meetings, transcribes conversations, generates summaries, and provides interactive chat with meeting content.

## Features

- 🤖 **Automated Bot**: Joins Webex meetings as "AI Space Notetaker"
- 🎙️ **Real-time Transcription**: Uses Groq Whisper API for high-quality speech-to-text
- 📝 **Smart Summaries**: Generates meeting summaries with key points and action items
- 💬 **Interactive Chat**: RAG-powered chatbot to query meeting content with timestamped citations
- 🔐 **Access Control**: Only meeting attendees can access their meeting data
- 📊 **Live Dashboard**: Real-time transcript viewing and meeting management

## Architecture

### Monorepo Structure
```
ai-meeting-notetaker/
├── services/
│   ├── backend/          # FastAPI + SQLAlchemy + Alembic
│   ├── bot-runner/       # Electron + Webex Browser SDK
│   └── frontend/         # Next.js React application
├── packages/
│   ├── shared-types/     # OpenAPI TypeScript client
│   └── shared-prompts/   # AI prompts for summaries/chat
└── infra/                # Docker infrastructure
```

### Technology Stack

**Backend (Python)**
- FastAPI with async support
- PostgreSQL with pgvector for embeddings
- Redis for job queues (RQ workers)
- MinIO for audio/artifact storage
- Alembic for database migrations

**Bot Runner (JavaScript/TypeScript)**
- Electron for desktop shell
- Webex Browser SDK for meeting integration
- WebAudio API for real-time audio processing
- WebSocket for audio streaming to backend

**Frontend (Node.js)**
- Next.js 14 with App Router
- Tailwind CSS + Headless UI
- SWR for data fetching
- Socket.IO for live transcript updates
- OpenAPI-generated TypeScript client

**AI Services**
- Groq Whisper API (transcription)
- Groq LLM API (summaries & chat)
- Vector embeddings for semantic search

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Python 3.11+ with pip
- Docker and Docker Compose
- Webex access token or Guest Issuer credentials

### 🚀 **Startup Instructions**

1. **Clone the repository**
   ```bash
   git clone https://github.com/balbanyan/ai-meeting-notetaker.git
   cd ai-meeting-notetaker
   ```

2. **Start infrastructure services**
   ```bash
   cd infra
   docker compose up -d
   ```
   This starts PostgreSQL, Redis, and MinIO services.

3. **Set up and start backend**
   ```bash
   cd services/backend
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -e .
   alembic upgrade head
   python -m uvicorn app.main:app --reload --port 8000
   ```

4. **Set up and start bot runner**
   ```bash
   cd services/bot-runner
   npm install
   npm run dev
   ```

5. **Set up and start frontend**
   ```bash
   cd services/frontend
   npm install
   npm run dev
   ```

### 🔧 **Environment Configuration**

Create `.env` files in each service directory based on the examples:

**Root directory** (`.env`):
```env
# Database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker

# Redis
REDIS_URL=redis://localhost:6379

# MinIO/S3
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=ai-notetaker

# Bot Service Authentication
BOT_SERVICE_TOKEN=your-bot-service-token-here

# AI Services
GROQ_API_KEY=your-groq-api-key-here
OPENAI_API_KEY=your-openai-api-key-here

# Webex Authentication (choose one)
WEBEX_ACCESS_TOKEN=your-webex-access-token
# OR
WEBEX_GUEST_ISSUER_ID=your-guest-issuer-id
WEBEX_GUEST_ISSUER_SECRET=your-guest-issuer-secret

# Bot Configuration
BOT_NAME=AI Space Notetaker
BOT_DISPLAY_NAME=AI Meeting Notetaker
BOT_EMAIL=ai-notetaker@yourcompany.com
```

**Frontend** (`services/frontend/.env.local`):
```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-generated-secret
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_WEBEX_ACCESS_TOKEN=your-webex-access-token
```

### 🎯 **Current Working Features**

After starting all services, you can:

1. **Access the frontend** at `http://localhost:3000`
2. **Add AI Bot to Meeting**: Click the "Add Bot" button and enter:
   - Webex meeting URL or ID
   - Meeting title
   - Host email
3. **Integration Testing**: The system will:
   - ✅ Create a meeting record in the database
   - ✅ Call the bot-runner service to join the meeting
   - ✅ Display success/error messages with proper error handling
   - ✅ Update meeting status in real-time

### 📊 **Service Architecture (Currently Working)**

```
Frontend (Next.js)     Backend (FastAPI)     Bot-runner (Electron)     Webex SDK
      ↓                        ↓                        ↓                  ↓
User clicks "Add Bot" → POST /meetings/join → POST /api/join-meeting → meeting.join()
      ↓                        ↓                        ↓                  ↓
   Response ←————————— Database update ←——————— Status update ←——— Success/Error
```

**What's working now:**
- ✅ Complete request/response flow
- ✅ Database integration with PostgreSQL
- ✅ Service-to-service HTTP communication
- ✅ Error propagation and user feedback
- ✅ Meeting status management

**Next phases will add:**
- 🚧 Audio streaming and transcription
- 🚧 Real-time transcript display
- 🚧 AI-powered summaries and chat

## Development Status

### ✅ **Phase 1 & 2 Complete: Core Infrastructure & Communication Bridge**
- [x] Monorepo structure and development environment
- [x] PostgreSQL + pgvector + Redis + MinIO infrastructure  
- [x] FastAPI backend with health checks and API endpoints
- [x] Database models and migrations (SQLAlchemy + Alembic)
- [x] Next.js frontend with development authentication
- [x] User-facing meeting management (join/leave)
- [x] OpenAPI client generation and type safety
- [x] Basic UI components and routing
- [x] **Bot runner Electron application with Webex SDK integration**
- [x] **HTTP API bridge: Frontend ↔ Backend ↔ Bot-runner ↔ Webex**
- [x] **Comprehensive error handling and status management**
- [x] **Real-time meeting status synchronization**
- [x] **Service-to-service authentication (Bearer tokens)**

### 🚧 **Phase 3-5: In Development**
- [ ] Real-time audio processing and streaming (WebSocket)
- [ ] STT worker (Groq Whisper integration)
- [ ] Summary generation worker (OpenAI/Groq LLM)
- [ ] Vector embedding worker for RAG
- [ ] WebSocket live transcript updates
- [ ] RAG chatbot functionality
- [ ] Meeting participant email resolution

### 📋 **Future Enhancements**
- [ ] Webex OAuth authentication (replacing personal tokens)
- [ ] Advanced summary types (action items, decisions, etc.)
- [ ] Meeting search and filtering
- [ ] Export functionality (PDF, DOCX)
- [ ] Slack/Teams integrations
- [ ] Mobile app support
- [ ] Production deployment configuration

## API Documentation

When running locally, visit `http://localhost:8000/docs` for interactive API documentation.

### Key Endpoints

- `GET /api/v1/health` - Health check
- `GET /api/v1/meetings` - List meetings
- `POST /api/v1/meetings/join` - Join meeting (user-facing)
- `GET /api/v1/meetings/{id}/transcript` - Get transcript
- `GET /api/v1/meetings/{id}/summary` - Get summary
- `POST /api/v1/chat/rag` - Chat with meeting content

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Webex Browser SDK](https://developer.webex.com/blog/how-to-build-meeting-bots-for-webex) for meeting integration
- [Groq](https://groq.com/) for fast AI inference
- [pgvector](https://github.com/pgvector/pgvector) for vector similarity search