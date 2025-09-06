"""
Simple Groq Whisper Transcription Service
Handles audio transcription using Groq's Whisper API
"""

import httpx
import logging
from typing import Dict, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

class GroqWhisperService:
    """Simple service for transcribing audio using Groq Whisper API"""
    
    def __init__(self):
        self.api_key = settings.whisper_groq_api
        self.base_url = settings.groq_api_base_url
        self.model = settings.whisper_model
        
        if not self.api_key:
            logger.warning("WHISPER_GROQ_API not configured - transcription will be disabled")
    
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
            # Prepare multipart form data for Groq API
            files = {
                'file': ('audio.wav', audio_data, 'audio/wav'),
                'model': (None, self.model),
                'response_format': (None, 'json'),  # Simple JSON response
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
                
                logger.info(f"✅ Transcription successful ({len(transcript_text)} chars)")
                
                return {
                    'success': True,
                    'transcript': transcript_text,
                    'model_used': self.model,
                    'language': result.get('language', 'en')
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
            chunk.chunk_transcript = result['transcript']
            chunk.transcription_status = "completed"
            logger.info(f"✅ Transcription completed for chunk UUID: {chunk.id}, chunk_id: {chunk.chunk_id}")
        else:
            chunk.transcription_status = "failed"
            logger.error(f"❌ Transcription failed for chunk UUID: {chunk.id}, chunk_id: {chunk.chunk_id}: {result['error']}")
        
        db.commit()
        
    except Exception as e:
        # Mark as failed on any error
        if 'chunk' in locals():
            chunk.transcription_status = "failed"
            db.commit()
        
        logger.error(f"❌ Background transcription failed for chunk {chunk_uuid}: {str(e)}")
        
    finally:
        db.close()
