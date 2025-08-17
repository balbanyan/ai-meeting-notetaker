import tempfile
import os
from uuid import UUID
from datetime import datetime
from typing import Optional
import io

from groq import Groq
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.entities import TranscriptSegment, JobRun, Meeting


def process_audio_chunk(
    meeting_id: str,
    audio_data: bytes,
    start_time_ms: int,
    end_time_ms: int,
    chunk_metadata: Optional[dict] = None
) -> dict:
    """
    Process audio chunk using Groq Whisper API
    
    Args:
        meeting_id: UUID of the meeting
        audio_data: Raw audio bytes (WAV format)
        start_time_ms: Start time of audio chunk in milliseconds
        end_time_ms: End time of audio chunk in milliseconds
        chunk_metadata: Optional metadata about the chunk
    
    Returns:
        dict: Processing results with transcript segments
    """
    db = SessionLocal()
    job_run = None
    
    try:
        # Create job run record
        job_run = JobRun(
            job_type="stt",
            meeting_id=UUID(meeting_id),
            status="running",
            input_data=f"audio_chunk_{start_time_ms}_{end_time_ms}",
            started_at=datetime.utcnow()
        )
        db.add(job_run)
        db.commit()
        db.refresh(job_run)
        
        # Initialize Groq client
        client = Groq(api_key=settings.GROQ_API_KEY)
        
        # Create temporary file for audio data
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_audio:
            temp_audio.write(audio_data)
            temp_audio_path = temp_audio.name
        
        try:
            # Transcribe audio using Groq Whisper
            with open(temp_audio_path, "rb") as audio_file:
                # Auto-detect language or use specified language
                language = None if settings.WHISPER_LANGUAGE == "auto" else settings.WHISPER_LANGUAGE
                
                transcription = client.audio.transcriptions.create(
                    file=audio_file,
                    model=settings.WHISPER_MODEL,
                    language=language,
                    response_format="verbose_json",
                    timestamp_granularities=["word"]
                )
            
            # Process transcription results
            segments_created = []
            
            if hasattr(transcription, 'words') and transcription.words:
                # Process word-level timestamps if available
                current_segment = []
                current_start = None
                current_speaker = None
                
                for word_info in transcription.words:
                    word_start_ms = int((word_info.start + start_time_ms / 1000) * 1000)
                    word_end_ms = int((word_info.end + start_time_ms / 1000) * 1000)
                    
                    if current_start is None:
                        current_start = word_start_ms
                    
                    current_segment.append(word_info.word)
                    
                    # Create segment every ~5 seconds or at natural breaks
                    if (word_end_ms - current_start) >= 5000 or len(current_segment) >= 20:
                        if current_segment:
                            segment_text = " ".join(current_segment).strip()
                            if segment_text:
                                transcript_segment = TranscriptSegment(
                                    meeting_id=UUID(meeting_id),
                                    speaker_name=current_speaker,
                                    speaker_email=None,  # Will be determined by attendee matching
                                    text=segment_text,
                                    start_ms=current_start,
                                    end_ms=word_end_ms,
                                    confidence=getattr(transcription, 'confidence', None),
                                    language=getattr(transcription, 'language', 'auto')
                                )
                                db.add(transcript_segment)
                                segments_created.append({
                                    'text': segment_text,
                                    'start_ms': current_start,
                                    'end_ms': word_end_ms
                                })
                        
                        current_segment = []
                        current_start = word_end_ms
            
            else:
                # Fallback: create single segment for entire chunk
                if transcription.text.strip():
                    transcript_segment = TranscriptSegment(
                        meeting_id=UUID(meeting_id),
                        speaker_name=None,
                        speaker_email=None,
                        text=transcription.text.strip(),
                        start_ms=start_time_ms,
                        end_ms=end_time_ms,
                        confidence=getattr(transcription, 'confidence', None),
                        language=getattr(transcription, 'language', 'auto')
                    )
                    db.add(transcript_segment)
                    segments_created.append({
                        'text': transcription.text.strip(),
                        'start_ms': start_time_ms,
                        'end_ms': end_time_ms
                    })
            
            # Update job run with success
            job_run.status = "completed"
            job_run.output_data = f"Created {len(segments_created)} transcript segments"
            job_run.completed_at = datetime.utcnow()
            
            db.commit()
            
            # Schedule embedding generation for new segments
            from app.core.queue import enqueue_job
            if segments_created:
                enqueue_job('embedding', generate_embeddings_for_meeting, meeting_id)
            
            return {
                "status": "success",
                "segments_created": len(segments_created),
                "language_detected": getattr(transcription, 'language', 'auto'),
                "job_id": str(job_run.id),
                "segments": segments_created
            }
            
        finally:
            # Clean up temporary file
            if os.path.exists(temp_audio_path):
                os.unlink(temp_audio_path)
    
    except Exception as e:
        # Update job run with error
        if job_run:
            job_run.status = "failed"
            job_run.error_message = str(e)
            job_run.completed_at = datetime.utcnow()
            db.commit()
        
        return {
            "status": "error",
            "error": str(e),
            "job_id": str(job_run.id) if job_run else None
        }
    
    finally:
        db.close()


def generate_embeddings_for_meeting(meeting_id: str):
    """Generate embeddings for all transcript segments in a meeting"""
    from app.workers.embedding_worker import generate_embeddings_for_segments
    
    db = SessionLocal()
    try:
        # Get all transcript segments for the meeting that don't have embeddings yet
        segments = db.query(TranscriptSegment).filter(
            TranscriptSegment.meeting_id == UUID(meeting_id)
        ).all()
        
        if segments:
            # Group segments into chunks for embedding
            text_chunks = []
            for segment in segments:
                text_chunks.append({
                    'id': str(segment.id),
                    'text': segment.text,
                    'start_ms': segment.start_ms,
                    'end_ms': segment.end_ms,
                    'meeting_id': meeting_id
                })
            
            return generate_embeddings_for_segments(text_chunks)
        
        return {"status": "no_segments_found"}
    
    finally:
        db.close()
