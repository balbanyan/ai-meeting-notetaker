"""
Word-Level Speaker Mapper
Maps transcript words to speakers using precise word timestamps from Groq Whisper.

Key features:
- Uses actual word timestamps (not estimated)
- Direct comparison with speaker event timestamps
- Allows segments to span multiple audio chunks
- High accuracy for speaker attribution
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


class AudioSpeakerMapper:
    """
    Service for mapping word-level transcripts to speaker events.
    Uses precise word timestamps from Groq Whisper API.
    """
    
    # NOTE: speaker_started_at already contains the ACTUAL start time
    # The bot debounces the SAVING (waits 3s), but stores the ORIGINAL detection time
    # So we DON'T need to adjust for debounce offset here
    
    def __init__(self):
        self.db = SessionLocal()
    
    def __del__(self):
        if hasattr(self, 'db'):
            self.db.close()
    
    async def process_completed_transcript(self, audio_chunk_id: str):
        """
        Process audio chunk after transcription completes.
        Maps words to speakers using precise timestamps.
        
        Args:
            audio_chunk_id: UUID of the completed audio chunk
        """
        try:
            logger.info(f"🗣️ Starting word-level speaker mapping for chunk UUID: {audio_chunk_id}")
            
            # 1. Get completed audio chunk with transcript
            chunk = self.get_audio_chunk_with_transcript(audio_chunk_id)
            if not chunk:
                logger.error(f"❌ Chunk not found: UUID {audio_chunk_id}")
                return
                
            # 2. Parse transcript JSON to get words
            transcript_data = self.parse_transcript_json(chunk.chunk_transcript)
            if not transcript_data or not transcript_data.get('words'):
                logger.warning(f"⚠️ No word timestamps available for chunk UUID: {audio_chunk_id}")
                return
                
            # 3. Validate timing data
            if not chunk.audio_started_at or not chunk.audio_ended_at:
                logger.warning(f"⚠️ Missing audio timing for chunk UUID: {audio_chunk_id}")
                return
            
            # 4. Get all speaker events for this meeting (not just this chunk)
            speaker_events = self.get_speaker_events_for_meeting(chunk.meeting_id)
            logger.info(f"🔍 Found {len(speaker_events)} speaker events for meeting")
            
            # 5. Map words to speakers
            word_speaker_mapping = self.map_words_to_speakers(
                transcript_data['words'],
                speaker_events,
                chunk.audio_started_at
            )
            
            # 6. Group consecutive words from same speaker into segments
            segments = self.group_words_into_segments(word_speaker_mapping)
            
            # 7. Save speaker transcript records
            for segment in segments:
                self.save_speaker_transcript(segment, chunk.id, chunk.meeting_id)
            
            logger.info(f"✅ Speaker mapping completed: {len(segments)} segments created for chunk UUID: {audio_chunk_id}")
            
        except Exception as e:
            logger.error(f"❌ Speaker mapping failed for chunk UUID: {audio_chunk_id}: {str(e)}")
            raise e
    
    def get_audio_chunk_with_transcript(self, audio_chunk_id: str) -> Optional[AudioChunk]:
        """Get audio chunk by ID with transcript"""
        try:
            chunk = self.db.query(AudioChunk).filter(AudioChunk.id == audio_chunk_id).first()
            return chunk
        except Exception as e:
            logger.error(f"❌ Error getting audio chunk UUID: {audio_chunk_id}: {str(e)}")
            return None
    
    def parse_transcript_json(self, transcript_str: str) -> Optional[Dict]:
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
    
    def get_speaker_events_for_meeting(self, meeting_id: UUID) -> List[SpeakerEvent]:
        """
        Get all speaker events for a meeting, ordered chronologically.
        We need all events (not just this chunk) to properly map speakers across chunks.
        """
        try:
            speaker_events = self.db.query(SpeakerEvent).filter(
                SpeakerEvent.meeting_id == meeting_id
            ).order_by(SpeakerEvent.speaker_started_at).all()
            
            return speaker_events
            
        except Exception as e:
            logger.error(f"❌ Error querying speaker events: {str(e)}")
            return []
    
    def map_words_to_speakers(
        self, 
        words: List[Dict], 
        speaker_events: List[SpeakerEvent],
        chunk_start_time: datetime
    ) -> List[Dict]:
        """
        Map each word to the active speaker at that moment.
        
        Args:
            words: List of word objects with 'word', 'start', 'end' keys (times relative to chunk)
            speaker_events: All speaker events for the meeting
            chunk_start_time: Absolute start time of this audio chunk
            
        Returns:
            List of word mappings with speaker info
        """
        word_mapping = []
        
        for word_data in words:
            # Calculate absolute time in meeting
            # word['start'] is relative to chunk start (in seconds)
            word_start_time = chunk_start_time + timedelta(seconds=word_data.get('start', 0))
            word_end_time = chunk_start_time + timedelta(seconds=word_data.get('end', 0))
            
            # Find active speaker at this time
            speaker = self.find_active_speaker_at_time(word_start_time, speaker_events)
            
            # Calculate confidence
            confidence = 0.95 if speaker else 0.3
            
            word_mapping.append({
                'word': word_data.get('word', ''),
                'start_time': word_start_time,
                'end_time': word_end_time,
                'speaker': speaker,
                'confidence': confidence
            })
        
        return word_mapping
    
    def find_active_speaker_at_time(
        self, 
        word_time: datetime, 
        speaker_events: List[SpeakerEvent]
    ) -> Optional[SpeakerEvent]:
        """
        Find which speaker was active at a given time.
        
        Args:
            word_time: Absolute time when word was spoken
            speaker_events: All speaker events (ordered chronologically)
            
        Returns:
            SpeakerEvent of active speaker, or None if unknown
        """
        # Find the most recent speaker event before the word time
        active_speaker = None
        for event in speaker_events:
            if event.speaker_started_at <= word_time:
                active_speaker = event
            else:
                # Events are ordered, so we can stop once we pass the word time
                break
        
        return active_speaker
    
    def group_words_into_segments(self, word_mapping: List[Dict]) -> List[Dict]:
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
            speaker = word_data['speaker']
            speaker_id = speaker.member_id if speaker else None
            speaker_name = speaker.member_name if speaker else 'Unknown Speaker'
            
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
        
        logger.info(f"📊 Grouped {len(word_mapping)} words into {len(segments)} speaker segments")
        
        return segments
    
    def save_speaker_transcript(self, segment: Dict, source_audio_chunk_id: UUID, meeting_id: UUID):
        """Save speaker transcript segment to database"""
        try:
            speaker_transcript = SpeakerTranscript(
                meeting_id=meeting_id,
                transcript_text=segment['text'].strip(),
                speaker_member_id=segment['speaker_id'],
                speaker_name=segment['speaker_name'],
                start_time=segment['start_time'],
                end_time=segment['end_time'],
                source_audio_chunk_id=source_audio_chunk_id,
                confidence_score=segment['confidence']
            )
            
            self.db.add(speaker_transcript)
            self.db.commit()
            self.db.refresh(speaker_transcript)
            
            logger.debug(f"💾 Saved segment: {segment['speaker_name']} ({segment['word_count']} words, confidence: {segment['confidence']:.2f})")
            
            # Broadcast new transcript to WebSocket subscribers (thread-safe)
            try:
                from app.api.websocket import manager
                
                transcript_data = {
                    "id": str(speaker_transcript.id),
                    "meeting_id": str(meeting_id),
                    "speaker_name": segment['speaker_name'],
                    "transcript_text": segment['text'].strip(),
                    "start_time": segment['start_time'].isoformat(),
                    "end_time": segment['end_time'].isoformat(),
                    "confidence_score": segment['confidence']
                }
                
                # Use thread-safe synchronous broadcast method
                manager.broadcast_transcript_sync(str(meeting_id), transcript_data)
                
            except Exception as ws_error:
                # Log error but don't fail the workflow
                logger.error(f"⚠️ Failed to broadcast transcript via WebSocket: {str(ws_error)}")
            
            # Send transcript to Palantir API (non-blocking)
            try:
                palantir_service.send_transcript(
                    speaker_name=segment['speaker_name'],
                    transcript_text=segment['text'].strip(),
                    start_time=segment['start_time'],
                    end_time=segment['end_time']
                )
            except Exception as palantir_error:
                # Log error but don't fail the workflow
                logger.error(f"⚠️ Failed to send transcript to Palantir: {str(palantir_error)}")
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ Failed to save speaker transcript: {str(e)}")
            raise e

