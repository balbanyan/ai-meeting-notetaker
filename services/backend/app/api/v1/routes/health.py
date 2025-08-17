from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db

router = APIRouter()


@router.get("/health")
async def health_check(db: Session = Depends(get_db)):
    """Health check endpoint"""
    try:
        # Test database connection
        result = db.execute(text("SELECT 1"))
        db_status = "healthy" if result.fetchone() else "unhealthy"
        
        # Test pgvector extension
        vector_result = db.execute(text("SELECT '[1,2,3]'::vector"))
        vector_status = "healthy" if vector_result.fetchone() else "unhealthy"
        
        return {
            "status": "healthy",
            "database": db_status,
            "pgvector": vector_status,
            "version": "0.1.0"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "version": "0.1.0"
        }
