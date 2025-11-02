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
    Simple background task to transcribe a single audio chunk
    
    Args:
        chunk_uuid: UUID of the audio chunk to transcribe
    """
    from app.core.database import SessionLocal
    from app.models.audio_chunk import AudioChunk
    
    db = SessionLocal()
    try:
        # Get the chunk from database
        chunk = db.query(AudioChunk).filter(AudioChunk.id == chunk_uuid).first()
        
        if not chunk:
            logger.error(f"❌ Chunk {chunk_uuid} not found in database")
            return
        
        if not chunk.chunk_audio:
            logger.error(f"❌ Chunk {chunk_uuid} has no audio data")
            return
        
        # Update status to processing
        chunk.transcription_status = "processing"
        db.commit()
        
        logger.info(f"🔄 Starting transcription for chunk UUID: {chunk.id}, chunk_id: {chunk.chunk_id}")
        
        # Transcribe using Groq
        result = await groq_service.transcribe_audio(chunk.chunk_audio)
        
        # Update database with result
        if result['success']:
            # Store transcript as JSON with word timestamps
            transcript_data = {
                'text': result['transcript'],
                'words': result.get('words', []),
                'duration': result.get('duration'),
                'language': result.get('language', 'en')
            }
            chunk.chunk_transcript = json.dumps(transcript_data)
            chunk.transcription_status = "completed"
            
            # COMMIT FIRST to ensure transcript is saved before speaker mapping
            db.commit()
            db.refresh(chunk)  # Refresh to ensure we have latest data
            
            logger.info(f"✅ Transcription completed for chunk UUID: {chunk.id}, chunk_id: {chunk.chunk_id} ({len(result.get('words', []))} words)")
            
            # Trigger speaker mapping after successful transcription (AFTER commit)
            if chunk.chunk_transcript and chunk.audio_started_at:
                try:
                    from app.services.audio_speaker_mapper import AudioSpeakerMapper
                    mapper = AudioSpeakerMapper()
                    await mapper.process_completed_transcript(str(chunk.id))
                    logger.info(f"🗣️ Speaker mapping completed for chunk UUID: {chunk.id}")
                except Exception as mapping_error:
                    logger.error(f"❌ Speaker mapping failed for chunk UUID: {chunk.id}: {str(mapping_error)}")
            else:
                logger.info(f"⚠️ Skipping speaker mapping - missing transcript or timing data for chunk UUID: {chunk.id}")
        else:
            chunk.transcription_status = "failed"
            db.commit()
            logger.error(f"❌ Transcription failed for chunk UUID: {chunk.id}, chunk_id: {chunk.chunk_id}: {result['error']}")
        
    except Exception as e:
        # Mark as failed on any error
        if 'chunk' in locals():
            chunk.transcription_status = "failed"
            db.commit()
        
        logger.error(f"❌ Background transcription failed for chunk {chunk_uuid}: {str(e)}")
        
    finally:
        db.close()
