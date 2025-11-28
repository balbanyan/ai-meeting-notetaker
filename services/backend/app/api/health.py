from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Basic health check endpoint for Cloud Run.
    
    Responds immediately without database check to ensure fast health checks.
    """
    return {
        "status": "healthy",
        "version": "2.0-mvp"
    }
