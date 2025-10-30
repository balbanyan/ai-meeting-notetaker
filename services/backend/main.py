from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os

# Import routers
from app.api.health import router as health_router
from app.api.meetings import router as meetings_router  
from app.api.audio import router as audio_router
from app.api.speaker_events import router as speaker_events_router

# Import database setup
from app.core.database import create_tables, reset_database

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

# Include routers
app.include_router(health_router, tags=["Health"])
app.include_router(meetings_router, tags=["Meetings"])
app.include_router(audio_router, tags=["Audio"])
app.include_router(speaker_events_router, tags=["Speaker Events"])


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
