from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Import routers
from app.api.health import router as health_router
from app.api.meetings import router as meetings_router  
from app.api.audio import router as audio_router

# Import database setup
from app.core.database import create_tables

# Create FastAPI app
app = FastAPI(
    title="AI Meeting Notetaker V2",
    description="Minimal MVP for meeting audio capture",
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


@app.on_event("startup")
async def startup_event():
    """Create database tables on startup"""
    print("🚀 Starting AI Meeting Notetaker...")
    create_tables()
    print("✅ Database tables created/verified")


@app.get("/")
async def root():
    return {
        "message": "AI Meeting Notetaker", 
        "version": "2.0.0",
        "docs": "/docs"
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
