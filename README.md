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

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Python 3.12+ with pip
- Docker and Docker Compose
- Webex account with access token

### Environment Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/balbanyan/ai-meeting-notetaker.git
   cd ai-meeting-notetaker
   ```

2. **Set up environment variables**
   
   Copy `.env.example` files in each service directory and fill in your values:
   
   **Backend** (`services/backend/.env`):
   ```env
   DATABASE_URL=postgresql://ai_notetaker:secure_password@localhost:5432/ai_notetaker
   REDIS_URL=redis://localhost:6379/0
   MINIO_URL=http://localhost:9000
   GROQ_API_KEY=your-groq-api-key
   OPENAI_API_KEY=your-openai-api-key
   BOT_SERVICE_TOKEN=your-generated-service-token
   ```

   **Bot Runner** (`services/bot-runner/.env`):
   ```env
   WEBEX_ACCESS_TOKEN=your-webex-access-token
   BACKEND_API_URL=http://localhost:8000
   BACKEND_WS_URL=ws://localhost:8000
   BOT_SERVICE_TOKEN=same-as-backend-token
   ```

   **Frontend** (`services/frontend/.env.local`):
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   NEXT_PUBLIC_WS_URL=ws://localhost:8000
   NEXT_PUBLIC_WEBEX_ACCESS_TOKEN=your-webex-access-token
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=your-generated-secret
   ```

3. **Start infrastructure services**
   ```bash
   cd infra
   docker compose up -d
   ```

4. **Set up and start backend**
   ```bash
   cd services/backend
   pip install -r requirements.txt  # or use poetry install
   alembic upgrade head
   PYTHONPATH=. python -m uvicorn app.main:app --reload --port 8000
   ```

5. **Set up and start bot runner**
   ```bash
   cd services/bot-runner
   npm install
   npm run dev
   ```

6. **Set up and start frontend**
   ```bash
   cd services/frontend
   npm install
   npm run dev
   ```

### Usage

1. **Access the frontend** at `http://localhost:3000`
2. **Sign in** using development mode (uses your Webex access token)
3. **Add AI Bot to Meeting** by entering a Webex meeting ID or URL
4. **Join the meeting** - the bot will appear as "AI Space Notetaker"
5. **View live transcript** in real-time during the meeting
6. **Generate summaries** after the meeting ends
7. **Chat with meeting content** using the RAG-powered chatbot

## Development Status

### ✅ Completed Features
- [x] Monorepo structure and development environment
- [x] PostgreSQL + pgvector + Redis + MinIO infrastructure
- [x] FastAPI backend with health checks and API endpoints
- [x] Database models and migrations
- [x] Next.js frontend with development authentication
- [x] User-facing meeting management (join/leave)
- [x] OpenAPI client generation and type safety
- [x] Basic UI components and routing

### 🚧 In Development
- [ ] Bot runner Webex integration
- [ ] Real-time audio processing and streaming
- [ ] STT worker (Groq Whisper integration)
- [ ] Summary generation worker
- [ ] Vector embedding worker
- [ ] WebSocket live transcript updates
- [ ] RAG chatbot functionality

### 📋 Planned Features
- [ ] Webex OAuth authentication (replacing personal tokens)
- [ ] Meeting participant email resolution
- [ ] Advanced summary types (action items, decisions, etc.)
- [ ] Meeting search and filtering
- [ ] Export functionality (PDF, DOCX)
- [ ] Slack/Teams integrations
- [ ] Mobile app support

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