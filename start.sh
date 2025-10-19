#!/bin/bash

# AI Meeting Notetaker - Startup Script
# Note: Bot-runner is now embedded and starts automatically with the backend

echo "🚀 Starting AI Meeting Notetaker..."

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -h, --help         Show this help message"
            echo ""
            echo "Note:"
            echo "  The bot-runner is now embedded in the backend and starts automatically"
            echo "  when the first meeting join request is made."
            echo ""
            echo "Environment Variables:"
            echo "  See services/backend/.env for configuration"
            echo ""
            echo "Examples:"
            echo "  $0                    # Start the backend (bot-runner starts on-demand)"
            exit 0
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
    kill $BACKEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    echo "✅ Services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "📦 Starting Backend Service (with embedded bot-runner)..."
cd services/backend
PYTHONPATH=. python -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ../..

# Wait a moment for backend to start
sleep 3

echo ""
echo "✅ Backend started successfully!"
echo "📊 Backend API: http://localhost:8000"
echo "📚 API Docs: http://localhost:8000/docs"
echo "🔧 Health Check: http://localhost:8000/health"
echo ""
echo "🤖 Bot Runner: Embedded (will start automatically on first meeting join)"
echo "   - Bot Runner API: http://localhost:3001 (after first meeting join)"
echo ""
echo "📋 Main API endpoints:"
echo "   POST /meetings/join              - Join a meeting (triggers bot-runner start)"
echo "   POST /meetings/fetch-and-register - Register meeting metadata"
echo "   POST /audio/chunk                - Upload audio chunk"
echo "   POST /events/speaker-started     - Log speaker event"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for background process
wait $BACKEND_PID
