from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from app.core.database import get_db
from app.core.config import settings

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Basic health check endpoint for Cloud Run.
    
    Responds immediately without database check to ensure fast health checks.
    Use /health/full for detailed health check with database validation.
    """
    return {
        "status": "healthy",
        "version": "2.0-mvp"
    }


@router.get("/health/full")
async def full_health_check(db: Session = Depends(get_db)):
    """Detailed health check with database validation"""
    try:
        # Test database connection
        result = db.execute(text("SELECT 1"))
        db_status = "healthy" if result.fetchone() else "unhealthy"
        
        return {
            "status": "healthy",
            "database": db_status,
            "version": "2.0-mvp"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "version": "2.0-mvp"
        }


@router.get("/health/api-key-debug")
async def debug_api_key(api_key: Optional[str] = Header(None, alias="API-Key")):
    """Debug endpoint to check API key configuration"""
    env_key_set = bool(settings.external_api_key)
    env_key_length = len(settings.external_api_key) if settings.external_api_key else 0
    header_key_received = api_key is not None
    header_key_length = len(api_key) if api_key else 0
    keys_match = api_key == settings.external_api_key if (api_key and settings.external_api_key) else False
    
    return {
        "environment": {
            "key_configured": env_key_set,
            "key_length": env_key_length,
            "key_preview": settings.external_api_key[:8] + "..." if env_key_set and env_key_length > 8 else "NOT_SET"
        },
        "request": {
            "header_received": header_key_received,
            "header_length": header_key_length,
            "header_preview": api_key[:8] + "..." if header_key_received and header_key_length > 8 else "NOT_RECEIVED"
        },
        "validation": {
            "keys_match": keys_match
        }
    }
