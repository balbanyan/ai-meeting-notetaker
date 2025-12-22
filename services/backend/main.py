from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import os
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)

# Reduce noise from third-party loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# Import routers
from app.api.health import router as health_router
from app.api.meetings import router as meetings_router  
from app.api.audio import router as audio_router
from app.api.speaker_events import router as speaker_events_router
from app.api.screenshots import router as screenshots_router
from app.api.websocket import router as websocket_router

# Import database setup
from app.core.database import create_tables, reset_database

# Import all models to ensure they're registered with SQLAlchemy
from app.models import (
    Meeting, 
    AudioChunk, 
    SpeakerEvent, 
    SpeakerTranscript, 
    ScreenshareCapture,
    NonVotingAssistantResponse
)

# Import bot-runner manager
from app.bot_runner import bot_runner_manager

# Create FastAPI app
app = FastAPI(
    title="AI Meeting Notetaker",
    description="Intelligent note-taking for meetings",
    version="2.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Custom exception handler for consistent JSON error responses
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """
    Custom error handler for HTTP exceptions.
    Provides consistent JSON error responses for authentication and other errors.
    """
    if exc.status_code == 401:
        return JSONResponse(
            status_code=401,
            content={"error": "Authentication required", "detail": exc.detail}
        )
    elif exc.status_code == 403:
        return JSONResponse(
            status_code=403,
            content={"error": "Access denied", "detail": exc.detail}
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail}
    )


# Include routers
# Health endpoints stay at root (best practice for load balancers)
app.include_router(health_router, tags=["Health"])
# All API endpoints use /api prefix for consistency
app.include_router(meetings_router, prefix="/api", tags=["Meetings"])
app.include_router(audio_router, prefix="/api", tags=["Audio"])
app.include_router(speaker_events_router, prefix="/api", tags=["Speaker Events"])
app.include_router(screenshots_router, prefix="/api", tags=["Screenshots"])
# WebSocket endpoints stay at /ws (no /api prefix)
app.include_router(websocket_router, tags=["WebSocket"])


@app.on_event("startup")
async def startup_event():
    """Create database tables on startup"""
    print("🚀 Starting AI Meeting Notetaker...")
    
    # Check if database reset is requested (for schema changes)
    if os.getenv("RESET_DATABASE", "false").lower() == "true":
        print("⚠️  RESET_DATABASE=true detected - dropping and recreating all tables")
        reset_database()
    else:
        create_tables()  # Handles concurrent initialization gracefully
    
    # Initialize WebSocket manager with main event loop
    from app.api.websocket import set_main_loop, start_redis_subscriber
    set_main_loop()
    
    # Start Redis subscriber for Celery broadcasts
    start_redis_subscriber()
    
    print("📦 Bot-runner will start on-demand when first meeting is joined")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    print("🛑 Shutting down AI Meeting Notetaker...")
    bot_runner_manager.stop()
    print("✅ Cleanup complete")


@app.get("/")
async def root():
    return {
        "message": "AI Space Notetaker", 
        "version": "2.0.0",
        "docs": "/docs"
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080, reload=True)
