"""
LLM Summary Celery Task

Wraps the existing generate_meeting_summary function for Celery execution.
"""

import asyncio
import logging
from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def generate_summary(self, meeting_id: str):
    """
    Celery task for meeting summary generation.
    
    Args:
        meeting_id: UUID of the meeting to summarize
        
    This task:
    1. Fetches all transcripts for the meeting
    2. Generates summary using Groq LLM API
    3. Stores summary in database
    4. Broadcasts via WebSocket
    5. Retries up to 3 times on failure
    """
    try:
        logger.info(f"🤖 [Celery] Starting LLM summary task for meeting: {meeting_id}")
        
        # Import here to avoid circular imports
        from app.services.llm_processor import generate_meeting_summary
        
        # Run the async function in a new event loop
        # Note: generate_meeting_summary expects a db session, but we pass None
        # since the function now creates its own sessions internally
        asyncio.run(generate_meeting_summary(meeting_id, None))
        
        logger.info(f"✅ [Celery] LLM summary task completed for meeting: {meeting_id}")
        
    except Exception as e:
        logger.error(f"❌ [Celery] LLM summary task failed for meeting {meeting_id}: {str(e)}")
        
        # Retry on failure
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            logger.error(f"❌ [Celery] Max retries exceeded for meeting {meeting_id}")
            
            # Store error in meeting summary
            try:
                from app.core.database import SessionLocal
                from app.models.meeting import Meeting
                
                db = SessionLocal()
                try:
                    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
                    if meeting:
                        meeting.meeting_summary = f"Error generating summary after 3 retries: {str(e)}"
                        db.commit()
                finally:
                    db.close()
            except Exception as db_error:
                logger.error(f"❌ [Celery] Failed to store error in meeting: {str(db_error)}")

