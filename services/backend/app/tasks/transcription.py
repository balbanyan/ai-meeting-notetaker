"""
Transcription Celery Task

Wraps the existing transcribe_chunk_async function for Celery execution.
Includes speaker mapping as part of the transcription workflow.
"""

import asyncio
import logging
from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def transcribe_chunk(self, chunk_uuid: str):
    """
    Celery task for audio transcription.
    
    Args:
        chunk_uuid: UUID of the audio chunk to transcribe
        
    This task:
    1. Transcribes audio using Groq Whisper API
    2. Triggers speaker mapping after transcription
    3. Retries up to 3 times on failure
    """
    try:
        logger.info(f"🎵 [Celery] Starting transcription task for chunk: {chunk_uuid}")
        
        # Import here to avoid circular imports
        from app.services.transcription import transcribe_chunk_async
        
        # Run the async function in a new event loop
        asyncio.run(transcribe_chunk_async(chunk_uuid))
        
        logger.info(f"✅ [Celery] Transcription task completed for chunk: {chunk_uuid}")
        
    except Exception as e:
        logger.error(f"❌ [Celery] Transcription task failed for chunk {chunk_uuid}: {str(e)}")
        
        # Retry on failure
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            logger.error(f"❌ [Celery] Max retries exceeded for chunk {chunk_uuid}")
            
            # Mark chunk as failed in database
            try:
                from app.core.database import SessionLocal
                from app.models.audio_chunk import AudioChunk
                
                db = SessionLocal()
                try:
                    chunk = db.query(AudioChunk).filter(AudioChunk.id == chunk_uuid).first()
                    if chunk:
                        chunk.transcription_status = "failed"
                        db.commit()
                finally:
                    db.close()
            except Exception as db_error:
                logger.error(f"❌ [Celery] Failed to mark chunk as failed: {str(db_error)}")

