from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

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
