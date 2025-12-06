"""
Non-Voting Checkpoint Celery Task

Wraps the existing trigger_non_voting_checkpoint function for Celery execution.
"""

import asyncio
import logging
from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=15)
def trigger_checkpoint(self, meeting_id: str, chunk_id: int):
    """
    Celery task for non-voting assistant checkpoint.
    
    Args:
        meeting_id: UUID of the meeting
        chunk_id: Chunk number that triggered this checkpoint
        
    This task:
    1. Aggregates new transcripts and screenshots since last checkpoint
    2. Calls Palantir non-voting API
    3. Stores response in database
    4. Broadcasts via WebSocket
    5. Retries up to 2 times on failure (longer delay due to API complexity)
    """
    try:
        logger.info(f"🎯 [Celery] Starting non-voting checkpoint task for meeting: {meeting_id}, chunk: {chunk_id}")
        
        # Import here to avoid circular imports
        from app.services.palantir_service import palantir_service
        
        # Run the async function in a new event loop
        # Note: trigger_non_voting_checkpoint expects a db session, but we pass None
        # since the function now creates its own sessions internally
        asyncio.run(palantir_service.trigger_non_voting_checkpoint(meeting_id, chunk_id, None))
        
        logger.info(f"✅ [Celery] Non-voting checkpoint task completed for meeting: {meeting_id}, chunk: {chunk_id}")
        
    except Exception as e:
        logger.error(f"❌ [Celery] Non-voting checkpoint task failed for meeting {meeting_id}, chunk {chunk_id}: {str(e)}")
        
        # Retry on failure
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            logger.error(f"❌ [Celery] Max retries exceeded for non-voting checkpoint - meeting: {meeting_id}, chunk: {chunk_id}")
            # Non-voting is optional, so we don't need to store error state

