"""
Simple Groq Whisper Transcription Service
Handles audio transcription using Groq's Whisper API with word-level timestamps
"""

import httpx
import json
import logging
from typing import Dict, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

class GroqWhisperService:
    """Simple service for transcribing audio using Groq Whisper API"""
    
    def __init__(self):
        self.api_key = settings.groq_api_key
        self.base_url = settings.groq_api_base_url
        self.model = settings.whisper_model
        
        if not self.api_key:
            logger.warning("GROQ_API_KEY not configured - transcription will be disabled")
    
    async def transcribe_audio(self, audio_data: bytes) -> Dict:
        """
        Transcribe audio chunk using Groq Whisper API
        
        Args:
            audio_data: WAV audio data as bytes
            
        Returns:
            Dict with success status and transcript or error
        """
        if not self.api_key:
            return {
                'success': False,
                'error': 'Groq API key not configured'
            }
        
        try:
            # Prepare multipart form data for Groq API with word-level timestamps
            files = {
                'file': ('audio.wav', audio_data, 'audio/wav'),
                'model': (None, self.model),
                'response_format': (None, 'verbose_json'),  # Required for word timestamps
                'timestamp_granularities[]': (None, 'word'),  # Request word-level timestamps
                # Note: Groq API doesn't support multiple languages in one request
                # Using auto-detect for English/Arabic support
                # 'language': (None, 'en'),  # Removed - using auto-detect for multilingual
                'temperature': (None, '0')  # Recommended for transcription
            }
            
            headers = {
                'Authorization': f'Bearer {self.api_key}'
            }
            
            logger.info(f"🎵 Transcribing audio chunk ({len(audio_data)} bytes) with {self.model}")
            
            # Make API call to Groq
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.base_url}/audio/transcriptions",
                    files=files,
                    headers=headers
                )
            
            # Handle response
            if response.status_code == 200:
                result = response.json()
                transcript_text = result.get('text', '').strip()
                words = result.get('words', [])
                
                logger.info(f"✅ Transcription successful ({len(transcript_text)} chars, {len(words)} words)")
                
                return {
                    'success': True,
                    'transcript': transcript_text,
                    'words': words,  # Word-level timestamps
                    'duration': result.get('duration'),
                    'language': result.get('language', 'en'),
                    'model_used': self.model
                }
            else:
                error_msg = f"Groq API Error: {response.status_code}"
                logger.error(f"❌ {error_msg}: {response.text}")
                
                return {
                    'success': False,
                    'error': error_msg,
                    'details': response.text
                }
                
        except httpx.TimeoutException:
            error_msg = "Groq API timeout"
            logger.error(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
            
        except Exception as e:
            error_msg = f"Transcription failed: {str(e)}"
            logger.error(f"❌ {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }


# Global service instance
groq_service = GroqWhisperService()


async def transcribe_chunk_async(chunk_uuid: str):
    """
    Transcribe audio chunk with optimized connection management.
    
    This function uses a 4-phase approach to minimize database connection hold time:
    Phase 1: Quick DB read (20ms) → copy data → release connection
    Phase 2: Groq API call (2-5s) WITHOUT holding DB connection
    Phase 3: Quick DB write (20ms) → release connection
    Phase 4: Trigger speaker mapping (separate connection)
    
    Total connection hold time: ~40ms (vs 3-6 seconds before optimization)
    
    Args:
        chunk_uuid: UUID of the audio chunk to transcribe
    """
    from app.core.database import SessionLocal
    from app.models.audio_chunk import AudioChunk
    
    # Phase 1: Quick DB read, copy data, release connection
    db = SessionLocal()
    try:
        chunk = db.query(AudioChunk).filter(AudioChunk.id == chunk_uuid).first()
        
        if not chunk or not chunk.chunk_audio:
            logger.error(f"❌ Chunk {chunk_uuid} not found or has no audio data")
            return
        
        # Update status to processing
        chunk.transcription_status = "processing"
        db.commit()
        
        # Copy data we need (so we can release the connection)
        audio_data = chunk.chunk_audio
        chunk_id = chunk.id
        meeting_id = chunk.meeting_id
        audio_started_at = chunk.audio_started_at
        chunk_number = chunk.chunk_id
        
        logger.info(f"🔄 Starting transcription for chunk UUID: {chunk_id}, chunk_id: {chunk_number}")
    finally:
        db.close()  # Release after ~20ms
    
    # Phase 2: Groq API call WITHOUT holding DB connection (2-5 seconds)
    try:
        result = await groq_service.transcribe_audio(audio_data)
        
        if not result['success']:
            raise Exception(f"Transcription failed: {result['error']}")
            
    except Exception as e:
        # Mark as failed in database
        db = SessionLocal()
        try:
            chunk = db.query(AudioChunk).filter(AudioChunk.id == chunk_id).first()
            if chunk:
                chunk.transcription_status = "failed"
                db.commit()
        finally:
            db.close()
        
        logger.error(f"❌ Transcription failed for chunk UUID: {chunk_id}: {str(e)}")
        return
    
    # Phase 3: Quick DB write, release connection
    db = SessionLocal()
    try:
        chunk = db.query(AudioChunk).filter(AudioChunk.id == chunk_id).first()
        if chunk:
            # Store transcript as JSON with word timestamps
            transcript_data = {
                'text': result['transcript'],
                'words': result.get('words', []),
                'duration': result.get('duration'),
                'language': result.get('language', 'en')
            }
            chunk.chunk_transcript = json.dumps(transcript_data)
            chunk.transcription_status = "completed"
            db.commit()
            
            logger.info(f"✅ Transcription completed for chunk UUID: {chunk_id}, chunk_id: {chunk_number} ({len(result.get('words', []))} words)")
    finally:
        db.close()  # Release after ~20ms
    
    # Phase 4: Trigger speaker mapping (separate connection)
    if audio_started_at:
        try:
            from app.services.audio_speaker_mapper import process_speaker_mapping_optimized
            await process_speaker_mapping_optimized(str(chunk_id))
            logger.info(f"🗣️ Speaker mapping completed - Meeting: {meeting_id}, Chunk UUID: {chunk_id}")
        except Exception as mapping_error:
            logger.error(f"❌ Speaker mapping failed - Meeting: {meeting_id}, Chunk UUID: {chunk_id}: {str(mapping_error)}")
    else:
        logger.info(f"⚠️ Skipping speaker mapping - missing timing data - Meeting: {meeting_id}, Chunk UUID: {chunk_id}")
