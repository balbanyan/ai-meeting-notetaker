"""
Vision Analysis Celery Task

Wraps the existing analyze_screenshot_async function for Celery execution.
"""

import asyncio
import logging
from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def analyze_screenshot(self, screenshot_uuid: str):
    """
    Celery task for screenshot vision analysis.
    
    Args:
        screenshot_uuid: UUID of the screenshot to analyze
        
    This task:
    1. Analyzes screenshot using Groq Vision API
    2. Stores analysis in database
    3. Retries up to 3 times on failure
    """
    try:
        logger.info(f"📸 [Celery] Starting vision analysis task for screenshot: {screenshot_uuid}")
        
        # Import here to avoid circular imports
        from app.api.screenshots import analyze_screenshot_async
        from app.services.vision_service import groq_vision_service
        
        # Run the async function in a new event loop
        asyncio.run(analyze_screenshot_async(screenshot_uuid, groq_vision_service))
        
        logger.info(f"✅ [Celery] Vision analysis task completed for screenshot: {screenshot_uuid}")
        
    except Exception as e:
        logger.error(f"❌ [Celery] Vision analysis task failed for screenshot {screenshot_uuid}: {str(e)}")
        
        # Retry on failure
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            logger.error(f"❌ [Celery] Max retries exceeded for screenshot {screenshot_uuid}")
            
            # Mark screenshot as failed in database
            try:
                from app.core.database import SessionLocal
                from app.models.screenshare_capture import ScreenshareCapture
                
                db = SessionLocal()
                try:
                    screenshot = db.query(ScreenshareCapture).filter(ScreenshareCapture.id == screenshot_uuid).first()
                    if screenshot:
                        screenshot.analysis_status = "failed"
                        db.commit()
                finally:
                    db.close()
            except Exception as db_error:
                logger.error(f"❌ [Celery] Failed to mark screenshot as failed: {str(db_error)}")

