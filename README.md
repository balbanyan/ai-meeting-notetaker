# AI Meeting Notetaker

An AI-powered meeting notetaker for Webex meetings that automatically captures and processes meeting audio.

## Features

- **Webex Integration**: Seamlessly join Webex meetings as a bot
- **Audio Capture**: Real-time audio recording in 10-second chunks
- **Database Storage**: Persistent storage in PostgreSQL database
- **Host Detection**: Automatically identifies and stores meeting host information
- **Secure Authentication**: Service-to-service authentication with token-based security

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL running on localhost:5432
- Webex Guest Issuer credentials

### Setup

1. **Database Setup**
   ```bash
   # Create database
   createdb ai_notetaker
   ```

2. **Install Dependencies**
   ```bash
   # Backend
   cd services/backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ../..
   
   # Bot Runner
   cd services/bot-runner
   npm install
   cd ../..
   ```

3. **Start Everything (Simple)**
   ```bash
   ./start.sh
   ```

   Or manually:
   ```bash
   # Terminal 1 - Backend
   cd services/backend
   PYTHONPATH=. python -m uvicorn app.main:app --reload --port 8000
   
   # Terminal 2 - Bot Runner
   cd services/bot-runner
   npm run dev
   ```

### Environment Configuration

Copy `.env.example` to `.env` and fill in your credentials.

## Architecture

- **Backend**: FastAPI + PostgreSQL for API endpoints and data storage
- **Bot-runner**: Electron + Webex SDK for meeting integration and audio capture
- **Database**: PostgreSQL with audio chunks table for persistent storage

## Technology Stack

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL, Pydantic
- **Bot-runner**: Electron, Webex Browser SDK, Node.js
- **Authentication**: JWT tokens with Webex Guest Issuer
- **Audio Processing**: Web Audio API with WAV format conversion
