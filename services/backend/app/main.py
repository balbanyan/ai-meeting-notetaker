from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import ensure_pgvector
from app.api.v1.routes import health, meetings, bot, ingest, transcript, summary


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    try:
        ensure_pgvector()
        print("✅ Database connection established")
    except Exception as e:
        print(f"⚠️  Database connection failed: {e}")
        print("API will start but database-dependent endpoints may fail")
    yield
    # Shutdown
    pass


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="0.1.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(meetings.router, prefix="/api/v1", tags=["meetings"])
app.include_router(bot.router, prefix="/api/v1", tags=["bot"])
app.include_router(ingest.router, prefix="/api/v1", tags=["ingest"])
app.include_router(transcript.router, prefix="/api/v1", tags=["transcript"])
app.include_router(summary.router, prefix="/api/v1", tags=["summary"])


@app.get("/")
async def root():
    return {"message": "AI Meeting Notetaker API", "version": "0.1.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
