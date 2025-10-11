#!/bin/bash

# AI Meeting Notetaker - Startup Script

echo "🚀 Starting AI Meeting Notetaker..."

# Parse command line arguments
MODE=""

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
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --gui              Start in GUI mode (Electron)"
            echo "  --headless         Start in headless mode (Puppeteer)"
            echo "  -h, --help         Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  BOT_MODE              Set to 'gui' or 'headless' (default: headless)"
            echo "  ENABLE_MULTISTREAM    Set to 'false' to disable multistream (default: enabled)"
            echo ""
            echo "Examples:"
            echo "  $0                    # Start in headless mode with multistream (default)"
            echo "  $0 --gui             # Start in GUI mode"
            echo "  BOT_MODE=gui $0      # Use environment variable for GUI mode"
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

# Set environment variables based on arguments
if [ -n "$MODE" ]; then
    export BOT_MODE="$MODE"
fi

# Show current configuration
CURRENT_MODE=${BOT_MODE:-"headless"}
echo "🎯 Mode: $CURRENT_MODE"

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
    npm run start &
    BOTRUNNER_PID=$!
    echo "   - Headless mode: API will be available at http://localhost:3001"
else
    npm run start:gui &
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
