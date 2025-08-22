#!/bin/bash

# AI Meeting Notetaker V2 - Startup Script

echo "🚀 Starting AI Meeting Notetaker V2..."

# Parse command line arguments
MODE=""
LOGGING=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --gui)
            MODE="gui"
            shift
            ;;
        --headless)
            MODE="headless"
            shift
            ;;
        --enable-logging)
            LOGGING="true"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --gui              Start in GUI mode (Electron)"
            echo "  --headless         Start in headless mode (Puppeteer)"
            echo "  --enable-logging   Enable verbose logging"
            echo "  -h, --help         Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  BOT_MODE           Set to 'gui' or 'headless' (default: gui)"
            echo "  ENABLE_LOGGING     Set to 'true' to enable logging (default: false)"
            echo ""
            echo "Examples:"
            echo "  $0                    # Start in GUI mode (default)"
            echo "  $0 --headless        # Start in headless mode"
            echo "  $0 --gui --enable-logging  # Start GUI with logging"
            echo "  BOT_MODE=headless $0  # Use environment variable"
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
    echo "❌ Please run this script from the ai-meeting-notetaker-v2 directory"
    exit 1
fi

# Set environment variables based on arguments
if [ -n "$MODE" ]; then
    export BOT_MODE="$MODE"
fi

if [ -n "$LOGGING" ]; then
    export ENABLE_LOGGING="$LOGGING"
fi

# Show current configuration
CURRENT_MODE=${BOT_MODE:-"gui"}
CURRENT_LOGGING=${ENABLE_LOGGING:-"false"}
echo "🎯 Mode: $CURRENT_MODE"
echo "🔧 Logging: $CURRENT_LOGGING"

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

# Start bot runner based on mode
if [ "$CURRENT_MODE" = "headless" ]; then
    if [ "$CURRENT_LOGGING" = "true" ]; then
        npm run dev:headless &
    else
        npm run start:headless &
    fi
    BOTRUNNER_PID=$!
    echo "   - Headless mode: API will be available at http://localhost:3001"
else
    if [ "$CURRENT_LOGGING" = "true" ]; then
        npm run dev &
    else
        npm run start &
    fi
    BOTRUNNER_PID=$!
    echo "   - GUI mode: Electron app should open"
fi

cd ../..

echo ""
echo "✅ Services started successfully!"
echo "📊 Backend API: http://localhost:8000"
echo "🔧 Backend Health: http://localhost:8000/health"

if [ "$CURRENT_MODE" = "headless" ]; then
    echo "🤖 Bot Runner API: http://localhost:3001"
    echo "🔍 Bot Runner Health: http://localhost:3001/health"
    echo ""
    echo "📋 Available API endpoints:"
    echo "   POST /join     - Join a meeting"
    echo "   POST /leave    - Leave a meeting"
    echo "   GET  /meetings - List active meetings"
else
    echo "🤖 Bot Runner: Electron GUI"
fi

echo ""
echo "Press Ctrl+C to stop all services"

# Wait for background processes
wait $BACKEND_PID $BOTRUNNER_PID
