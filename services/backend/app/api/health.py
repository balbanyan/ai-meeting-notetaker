from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter()


@router.get("/health")
async def health_check(db: Session = Depends(get_db)):
    """Basic health check endpoint"""
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
