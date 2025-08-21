#!/bin/bash

# AI Meeting Notetaker V2 - Startup Script

echo "🚀 Starting AI Meeting Notetaker V2..."

# Check if we're in the right directory
if [ ! -f "start.sh" ]; then
    echo "❌ Please run this script from the ai-meeting-notetaker-v2 directory"
    exit 1
fi

# Function to kill background processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $BACKEND_PID $BOTRUNNER_PID 2>/dev/null
    wait $BACKEND_PID $BOTRUNNER_PID 2>/dev/null
    echo "✅ Services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "📦 Starting Backend Service..."
cd services/backend
PYTHONPATH=. python -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ../..

# Wait a moment for backend to start
sleep 3

echo "🤖 Starting Bot Runner..."
cd services/bot-runner
npm run dev &
BOTRUNNER_PID=$!
cd ../..

echo ""
echo "✅ Services started successfully!"
echo "📊 Backend API: http://localhost:8000"
echo "🔧 Backend Health: http://localhost:8000/health"
echo "🤖 Bot Runner: Electron app should open"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for background processes
wait $BACKEND_PID $BOTRUNNER_PID
