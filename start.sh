#!/bin/bash

# AI Meeting Notetaker - Startup Script
# Starts backend and optionally frontend for embedded app development

echo "🚀 Starting AI Meeting Notetaker..."

# Default options
START_FRONTEND=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -h, --help         Show this help message"
            echo "  -f, --frontend     Also start the frontend dev server"
            echo ""
            echo "Architecture:"
            echo "  - Backend (FastAPI): Handles meeting registration, audio storage, transcription"
            echo "  - Bot-runner (Node.js): Starts on-demand when first meeting is joined"
            echo "  - Frontend (React): Webex embedded app (optional for development)"
            echo ""
            echo "Environment Variables:"
            echo "  See services/backend/.env and services/frontend/.env for configuration"
            echo ""
            echo "Examples:"
            echo "  $0                    # Start backend only (bot-runner starts on-demand)"
            echo "  $0 --frontend         # Start backend + frontend dev server"
            exit 0
            ;;
        -f|--frontend)
            START_FRONTEND=true
            shift
            ;;
        *)
            echo "❌ Unknown option: $1"
            echo "Use $0 --help for usage information"
            exit 1
            ;;
    esac
done

# Check if we're in the right directory
if [ ! -f "start.sh" ]; then
    echo "❌ Please run this script from the ai-meeting-notetaker directory"
    exit 1
fi

# Function to kill background processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        wait $BACKEND_PID 2>/dev/null
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        wait $FRONTEND_PID 2>/dev/null
    fi
    echo "✅ Services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "📦 Starting Backend Service..."
cd services/backend
PYTHONPATH=. python3 -m uvicorn main:app --reload --port 8080 &
BACKEND_PID=$!
cd ../..

# Wait a moment for backend to start
sleep 3

echo ""
echo "✅ Backend started successfully!"
echo "📊 Backend API: http://localhost:8080"
echo "📚 API Docs: http://localhost:8080/docs"
echo "🔧 Health Check: http://localhost:8080/health"
echo ""

# Start frontend if requested
if [ "$START_FRONTEND" = true ]; then
    echo "📱 Starting Frontend Development Server..."
    cd services/frontend
    npm run dev &
    FRONTEND_PID=$!
    cd ../..
    
    sleep 2
    echo "✅ Frontend started successfully!"
    echo "🌐 Frontend Dev: http://localhost:5173"
    echo "💡 Dev Mode: http://localhost:5173?VITE_DEV_MODE=true"
    echo ""
fi

echo "🤖 Bot Runner: On-demand (starts automatically on first meeting join)"
echo "   - Bot Runner API: http://localhost:3001 (after first meeting join)"
echo ""
echo "📋 Main API endpoints:"
echo "   GET  /health                     - Health check (at root)"
echo "   POST /api/meetings/register-and-join - Register meeting and trigger bot (embedded app)"
echo "   POST /api/meetings/test-join     - Test bot join without API calls (development)"
echo "   POST /api/audio/chunk            - Upload audio chunk from bot"
echo "   POST /api/events/speaker-started - Log speaker event from bot"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for background processes
if [ "$START_FRONTEND" = true ]; then
    wait -n $BACKEND_PID $FRONTEND_PID
else
    wait $BACKEND_PID
fi
