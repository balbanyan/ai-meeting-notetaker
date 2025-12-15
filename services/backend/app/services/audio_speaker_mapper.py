"""
Word-Level Speaker Mapper
Maps transcript words to speakers using precise word timestamps from Groq Whisper.

Key features:
- Uses actual word timestamps (not estimated)
- Direct comparison with speaker event timestamps
- Allows segments to span multiple audio chunks
- High accuracy for speaker attribution
- Optimized connection management for high concurrency
"""

import json
import logging
from sqlalchemy.orm import Session
from sqlalchemy import UUID
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from app.core.database import SessionLocal
from app.models.audio_chunk import AudioChunk
from app.models.speaker_event import SpeakerEvent
from app.models.speaker_transcript import SpeakerTranscript
from app.services.palantir_service import palantir_service

logger = logging.getLogger(__name__)


async def process_speaker_mapping_optimized(audio_chunk_id: str):
    """
    Process speaker mapping with optimized connection usage for high concurrency.
    
    This function uses a 4-phase approach to minimize database connection hold time:
    Phase 1: Quick DB read (50ms) → copy data → release connection
    Phase 2: CPU-intensive mapping (100-200ms) WITHOUT holding DB connection
    Phase 3: Batch DB insert (50ms) → release connection
    Phase 4: WebSocket broadcast (non-blocking)
    
    Total connection hold time: ~100ms (vs 500-1000ms with class-based approach)
        
        Args:
            audio_chunk_id: UUID of the completed audio chunk
        """
    
    # Phase 1: Get data from database, then release connection
    db = SessionLocal()
    try:
        logger.info(f"🗣️ Starting word-level speaker mapping for chunk UUID: {audio_chunk_id}")
        
        # Get completed audio chunk with transcript
        chunk = db.query(AudioChunk).filter(AudioChunk.id == audio_chunk_id).first()
        if not chunk:
            logger.error(f"❌ Chunk not found: UUID {audio_chunk_id}")
            return
                
        # Parse transcript JSON to get words
        transcript_data = _parse_transcript_json(chunk.chunk_transcript)
        if not transcript_data or not transcript_data.get('words'):
            logger.warning(f"⚠️ No word timestamps available for chunk UUID: {audio_chunk_id}")
            return
                
        # Validate timing data
        if not chunk.audio_started_at or not chunk.audio_ended_at:
            logger.warning(f"⚠️ Missing audio timing for chunk UUID: {audio_chunk_id}")
            return
            
        # Get all speaker events for this meeting
        speaker_events = db.query(SpeakerEvent).filter(
            SpeakerEvent.meeting_id == chunk.meeting_id
        ).order_by(SpeakerEvent.speaker_started_at).all()
        
        # Copy data we need (so we can release the connection)
        words = transcript_data['words']
        audio_started_at = chunk.audio_started_at
        meeting_id = chunk.meeting_id
        chunk_id = chunk.chunk_id
        
        # Copy speaker events to avoid lazy loading issues
        speaker_events_data = [{
            'member_id': event.member_id,
            'member_name': event.member_name,
            'speaker_started_at': event.speaker_started_at
        } for event in speaker_events]
        
    finally:
        db.close()  # Release after ~50ms
    
    # Phase 2: CPU-intensive mapping WITHOUT holding database connection
    word_speaker_mapping = _map_words_to_speakers(
        words,
        speaker_events_data,
        audio_started_at
    )
            
    segments = _group_words_into_segments(word_speaker_mapping)
    
    if not segments:
        logger.info(f"⚠️ No segments created for chunk UUID: {audio_chunk_id}")
        return
    
    # Phase 3: Insert all segments and extract data for broadcasting
    db = SessionLocal()
    broadcast_data_list = []
    try:
        for segment in segments:
            speaker_transcript = SpeakerTranscript(
                meeting_id=meeting_id,
                transcript_text=segment['text'].strip(),
                speaker_member_id=segment['speaker_id'],
                speaker_name=segment['speaker_name'],
                start_time=segment['start_time'],
                end_time=segment['end_time'],
                source_audio_chunk_id=audio_chunk_id,
                confidence_score=segment['confidence']
            )
            db.add(speaker_transcript)
        
        # Commit all at once for better performance
        db.commit()
            
        # Extract data for broadcasting BEFORE closing session
        # Query back to get IDs (more reliable than accessing from objects)
        saved_transcripts = db.query(SpeakerTranscript).filter(
            SpeakerTranscript.source_audio_chunk_id == audio_chunk_id
        ).all()
        
        for transcript in saved_transcripts:
            broadcast_data_list.append({
                "id": str(transcript.id),
                "meeting_id": str(meeting_id),
                "speaker_name": transcript.speaker_name,
                "transcript_text": transcript.transcript_text,
                "start_time": transcript.start_time.isoformat(),
                "end_time": transcript.end_time.isoformat(),
                "confidence_score": transcript.confidence_score
            })
        
        logger.info(f"✅ Speaker mapping completed: {len(segments)} segments created for chunk UUID: {audio_chunk_id}")
            
    finally:
        db.close()  # Release after ~50ms
    
    # Phase 4: WebSocket broadcast and Palantir (non-blocking, no DB connection needed)
    try:
        from app.api.websocket import manager
        
        for transcript_data in broadcast_data_list:
            # Use thread-safe synchronous broadcast method
            manager.broadcast_transcript_sync(str(meeting_id), transcript_data)
            
            # Send to Palantir (non-blocking)
            try:
                # Parse timestamps back from ISO format for Palantir
                from datetime import datetime
                start_time = datetime.fromisoformat(transcript_data['start_time'])
                end_time = datetime.fromisoformat(transcript_data['end_time'])
                
                palantir_service.send_transcript(
                    speaker_name=transcript_data['speaker_name'],
                    transcript_text=transcript_data['transcript_text'],
                    start_time=start_time,
                    end_time=end_time
                )
            except Exception as palantir_error:
                logger.error(f"⚠️ Failed to send transcript to Palantir: {str(palantir_error)}")
                
    except Exception as ws_error:
        logger.error(f"⚠️ Failed to broadcast transcript via WebSocket: {str(ws_error)}")
    
    # Phase 5: Check if we should trigger non-voting checkpoint
    db = SessionLocal()
    try:
        from app.core.config import settings
        from app.models.meeting import Meeting
        
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if meeting:
            meeting_non_voting_enabled = meeting.non_voting_enabled
            meeting_call_frequency = meeting.non_voting_call_frequency or settings.non_voting_call_frequency
        else:
            meeting_non_voting_enabled = False
            meeting_call_frequency = settings.non_voting_call_frequency
        
        if meeting_non_voting_enabled and chunk_id % meeting_call_frequency == 0:
            # Queue non-voting checkpoint to Celery (persistent task queue)
            from app.tasks.non_voting import trigger_checkpoint
            trigger_checkpoint.delay(str(meeting_id), chunk_id)
            logger.info(f"🎯 Non-voting checkpoint queued [Celery] for meeting {meeting_id} at chunk {chunk_id}")
    finally:
        db.close()


def _parse_transcript_json(transcript_str: str) -> Optional[Dict]:
    """
    Parse transcript JSON from chunk_transcript column.
    Handles both new JSON format and old plain text format.
    
    Returns:
        Dict with 'text' and 'words' keys, or None if parsing fails
    """
    if not transcript_str:
        return None
    
    try:
        # Try to parse as JSON (new format)
        if transcript_str.strip().startswith('{'):
            return json.loads(transcript_str)
        else:
            # Old format (plain text) - no word timestamps available
            logger.warning("Old transcript format detected (plain text, no word timestamps)")
            return None
    except json.JSONDecodeError as e:
        logger.error(f"❌ Failed to parse transcript JSON: {str(e)}")
        return None
    

def _map_words_to_speakers(
    words: List[Dict], 
    speaker_events_data: List[Dict],
    chunk_start_time: datetime
) -> List[Dict]:
    """
    Map each word to the active speaker at that moment.
    
    Args:
        words: List of word objects with 'word', 'start', 'end' keys (times relative to chunk)
        speaker_events_data: All speaker event data for the meeting
        chunk_start_time: Absolute start time of this audio chunk
        
    Returns:
        List of word mappings with speaker info
    """
    word_mapping = []
    
    for word_data in words:
        # Calculate absolute time in meeting
        word_start_time = chunk_start_time + timedelta(seconds=word_data.get('start', 0))
        word_end_time = chunk_start_time + timedelta(seconds=word_data.get('end', 0))
        
        # Find active speaker at this time
        speaker_data = _find_active_speaker_at_time(word_start_time, speaker_events_data)
        
        # Calculate confidence
        confidence = 0.95 if speaker_data else 0.3
        
        word_mapping.append({
            'word': word_data.get('word', ''),
            'start_time': word_start_time,
            'end_time': word_end_time,
            'speaker': speaker_data,
            'confidence': confidence
        })
    
    return word_mapping
    

def _find_active_speaker_at_time(
    word_time: datetime, 
    speaker_events_data: List[Dict]
) -> Optional[Dict]:
    """
    Find which speaker was active at a given time.
    
    Args:
        word_time: Absolute time when word was spoken
        speaker_events_data: All speaker event data (ordered chronologically)
        
    Returns:
        Speaker data dict of active speaker, or None if unknown
    """
    # Find the most recent speaker event before the word time
    active_speaker = None
    for event_data in speaker_events_data:
        if event_data['speaker_started_at'] <= word_time:
            active_speaker = event_data
        else:
            # Events are ordered, so we can stop once we pass the word time
            break
    
    # If found, return it
    if active_speaker:
        return active_speaker
    
    # Look-ahead: Check if a speaker event exists within a few seconds after
    # This handles race conditions where transcription completes before speaker events are saved
    LOOK_AHEAD_WINDOW = timedelta(seconds=5)
    for event_data in speaker_events_data:
        if event_data['speaker_started_at'] > word_time:
            # If speaker started within 5s after word, assume they were already speaking
            if event_data['speaker_started_at'] <= word_time + LOOK_AHEAD_WINDOW:
                logger.debug(f"🔍 Look-ahead: Found speaker event at {event_data['speaker_started_at']} for word at {word_time}")
                return event_data
            # Events are ordered, so stop if we're past the look-ahead window
            break
    
    return None
    

def _group_words_into_segments(word_mapping: List[Dict]) -> List[Dict]:
    """
    Group consecutive words from the same speaker into natural segments.
    
    Args:
        word_mapping: List of words with speaker info
        
    Returns:
        List of segment dictionaries ready for database storage
    """
    if not word_mapping:
        return []
    
    segments = []
    current_segment = None
    
    for word_data in word_mapping:
        speaker_data = word_data['speaker']
        speaker_id = speaker_data['member_id'] if speaker_data else None
        speaker_name = speaker_data['member_name'] if speaker_data else 'Unknown Speaker'
        
        # Check if we should continue current segment or start new one
        if current_segment and current_segment['speaker_id'] == speaker_id:
            # Same speaker - append word to current segment
            current_segment['text'] += ' ' + word_data['word']
            current_segment['end_time'] = word_data['end_time']
            current_segment['word_count'] += 1
        else:
            # New speaker - save current segment and start new one
            if current_segment:
                segments.append(current_segment)
            
            current_segment = {
                'text': word_data['word'],
                'speaker_id': speaker_id,
                'speaker_name': speaker_name,
                'start_time': word_data['start_time'],
                'end_time': word_data['end_time'],
                'confidence': word_data['confidence'],
                'word_count': 1
            }
    
    # Don't forget the last segment
    if current_segment:
        segments.append(current_segment)
    
    return segments
    

# Legacy class-based interface for backward compatibility
# This maintains the existing API while using the optimized function internally
class AudioSpeakerMapper:
    """
    DEPRECATED: Use process_speaker_mapping_optimized() directly instead.
    
    This class is maintained for backward compatibility only.
    """
    
    # NOTE: speaker_started_at already contains the ACTUAL start time
    # The bot debounces the SAVING (waits 3s), but stores the ORIGINAL detection time
    # So we DON'T need to adjust for debounce offset here
    
    def __init__(self):
        logger.warning("AudioSpeakerMapper class is deprecated. Use process_speaker_mapping_optimized() instead.")
        self.db = SessionLocal()
    
    def __del__(self):
        if hasattr(self, 'db'):
            self.db.close()
    
    async def process_completed_transcript(self, audio_chunk_id: str):
        """
        DEPRECATED: Use process_speaker_mapping_optimized() directly.
        
        Maintained for backward compatibility.
        """
        # Close the connection we opened in __init__ (we don't need it)
        if hasattr(self, 'db'):
            self.db.close()
        
        # Use the optimized function instead
        await process_speaker_mapping_optimized(audio_chunk_id)

