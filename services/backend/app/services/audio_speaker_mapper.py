from sqlalchemy.orm import Session
from sqlalchemy import UUID
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import re
from app.core.database import SessionLocal
from app.models.audio_chunk import AudioChunk
from app.models.speaker_event import SpeakerEvent
from app.models.speaker_transcript import SpeakerTranscript


class AudioSpeakerMapper:
    """
    Service for mapping audio chunk transcripts to speaker events
    Uses combined time-window and sentence splitting approach
    """
    
    def __init__(self):
        self.db = SessionLocal()
    
    def __del__(self):
        if hasattr(self, 'db'):
            self.db.close()
    
    async def process_completed_transcript(self, audio_chunk_id: str):
        """Process audio chunk after transcription completes"""
        try:
            print(f"🗣️ Starting speaker mapping for chunk {audio_chunk_id}")
            
            # 1. Get completed audio chunk with transcript and timing
            chunk = self.get_audio_chunk_with_transcript(audio_chunk_id)
            if not chunk:
                print(f"❌ Chunk not found: {audio_chunk_id}")
                return
                
            if not chunk.chunk_transcript:
                print(f"⚠️ No transcript available for chunk {audio_chunk_id}")
                return
                
            if not chunk.audio_started_at or not chunk.audio_ended_at:
                print(f"⚠️ Missing audio timing for chunk {audio_chunk_id}")
                return
            
            # 2. Find speaker events for this timeframe
            speaker_events = self.find_speaker_events_for_chunk(chunk)
            print(f"🔍 Found {len(speaker_events)} speaker events for chunk timeframe")
            
            # 3. Apply mapping algorithm
            transcript_segments = self.map_transcript_to_speakers(
                chunk.chunk_transcript,
                speaker_events,
                chunk.audio_started_at,
                chunk.audio_ended_at
            )
            
            # 4. Save speaker transcript records
            for segment in transcript_segments:
                self.save_speaker_transcript(segment, chunk.id, chunk.meeting_id)
            
            print(f"✅ Speaker mapping completed: {len(transcript_segments)} segments created for chunk {audio_chunk_id}")
            
        except Exception as e:
            print(f"❌ Speaker mapping failed for chunk {audio_chunk_id}: {str(e)}")
            raise e
    
    def get_audio_chunk_with_transcript(self, audio_chunk_id: str) -> Optional[AudioChunk]:
        """Get audio chunk by ID with transcript"""
        try:
            chunk = self.db.query(AudioChunk).filter(AudioChunk.id == audio_chunk_id).first()
            return chunk
        except Exception as e:
            print(f"❌ Error getting audio chunk {audio_chunk_id}: {str(e)}")
            return None
    
    def find_speaker_events_for_chunk(self, chunk: AudioChunk) -> List[SpeakerEvent]:
        """Find speaker events that overlap with chunk's audio timeframe"""
        
        # Use actual audio timing with small buffer for edge cases
        buffer_seconds = 2
        query_start = chunk.audio_started_at - timedelta(seconds=buffer_seconds)
        query_end = chunk.audio_ended_at + timedelta(seconds=buffer_seconds)
        
        try:
            speaker_events = self.db.query(SpeakerEvent).filter(
                SpeakerEvent.meeting_id == chunk.meeting_id,
                SpeakerEvent.speaker_started_at >= query_start,
                SpeakerEvent.speaker_started_at <= query_end
            ).order_by(SpeakerEvent.speaker_started_at).all()
            
            print(f"🔍 Speaker query: {chunk.audio_started_at} to {chunk.audio_ended_at} (±{buffer_seconds}s buffer)")
            print(f"   Found {len(speaker_events)} speaker events")
            
            return speaker_events
            
        except Exception as e:
            print(f"❌ Error querying speaker events: {str(e)}")
            return []
    
    def map_transcript_to_speakers(self, transcript: str, speaker_events: List[SpeakerEvent], 
                                 audio_start: datetime, audio_end: datetime) -> List[Dict]:
        """Map transcript segments to speakers using combined approach"""
        
        # Handle no speakers case
        if not speaker_events:
            return [self.create_unknown_speaker_segment(transcript, audio_start, audio_end)]
        
        # Handle single speaker case
        if len(speaker_events) == 1:
            return [self.create_single_speaker_segment(transcript, speaker_events[0], audio_start, audio_end)]
        
        # Handle multiple speakers case
        return self.split_transcript_for_multiple_speakers(transcript, speaker_events, audio_start, audio_end)
    
    def create_unknown_speaker_segment(self, transcript: str, audio_start: datetime, audio_end: datetime) -> Dict:
        """Create segment for unknown speaker"""
        return {
            'transcript_text': transcript.strip(),
            'speaker_member_id': None,
            'speaker_name': 'Unknown Speaker',
            'start_time': audio_start,
            'end_time': audio_end,
            'confidence_score': 0.3
        }
    
    def create_single_speaker_segment(self, transcript: str, speaker_event: SpeakerEvent, 
                                    audio_start: datetime, audio_end: datetime) -> Dict:
        """Create segment for single speaker"""
        
        # Use speaker start time if it's within the chunk, otherwise use chunk start
        segment_start = max(speaker_event.speaker_started_at, audio_start)
        
        return {
            'transcript_text': transcript.strip(),
            'speaker_member_id': speaker_event.member_id,
            'speaker_name': speaker_event.member_name,
            'start_time': segment_start,
            'end_time': audio_end,
            'confidence_score': 0.9  # High confidence for single speaker
        }
    
    def split_transcript_for_multiple_speakers(self, transcript: str, speaker_events: List[SpeakerEvent],
                                             audio_start: datetime, audio_end: datetime) -> List[Dict]:
        """Split transcript for multiple speakers using time windows + sentence boundaries"""
        
        # Step 1: Create speaker time windows
        speaker_windows = self.create_speaker_time_windows(speaker_events, audio_start, audio_end)
        
        # Step 2: Split transcript into sentences
        sentences = self.split_into_sentences(transcript)
        
        # Step 3: Map each sentence to best speaker window
        segments = []
        chunk_duration = (audio_end - audio_start).total_seconds()
        
        for i, sentence in enumerate(sentences):
            if not sentence.strip():
                continue
                
            # Estimate sentence timing within chunk (proportional distribution)
            sentence_start_ratio = i / len(sentences)
            sentence_end_ratio = (i + 1) / len(sentences)
            
            sentence_start = audio_start + timedelta(seconds=sentence_start_ratio * chunk_duration)
            sentence_end = audio_start + timedelta(seconds=sentence_end_ratio * chunk_duration)
            
            # Find best matching speaker window
            best_window = self.find_best_speaker_window(speaker_windows, sentence_start, sentence_end)
            confidence = self.calculate_confidence(best_window, sentence_start, sentence_end, len(speaker_events))
            
            segments.append({
                'transcript_text': sentence.strip(),
                'speaker_member_id': best_window['speaker'].member_id if best_window else None,
                'speaker_name': best_window['speaker'].member_name if best_window else 'Unknown Speaker',
                'start_time': sentence_start,
                'end_time': sentence_end,
                'confidence_score': confidence
            })
        
        return segments
    
    def create_speaker_time_windows(self, speaker_events: List[SpeakerEvent], 
                                  audio_start: datetime, audio_end: datetime) -> List[Dict]:
        """Create time windows for each speaker"""
        
        windows = []
        for i, event in enumerate(speaker_events):
            window_start = max(event.speaker_started_at, audio_start)
            
            # Window ends when next speaker starts or chunk ends
            next_event = speaker_events[i + 1] if i + 1 < len(speaker_events) else None
            window_end = min(next_event.speaker_started_at if next_event else audio_end, audio_end)
            
            if window_end > window_start:  # Valid window
                windows.append({
                    'speaker': event,
                    'start': window_start,
                    'end': window_end,
                    'duration': (window_end - window_start).total_seconds()
                })
        
        return windows
    
    def split_into_sentences(self, transcript: str) -> List[str]:
        """Split transcript into sentences using simple regex"""
        # Simple sentence splitting on periods, exclamation marks, question marks
        sentences = re.split(r'[.!?]+', transcript)
        # Remove empty sentences and clean whitespace
        return [s.strip() for s in sentences if s.strip()]
    
    def find_best_speaker_window(self, windows: List[Dict], sentence_start: datetime, 
                                sentence_end: datetime) -> Optional[Dict]:
        """Find speaker window with best overlap for sentence timing"""
        
        best_window = None
        best_overlap = 0
        
        for window in windows:
            # Calculate overlap between sentence time and speaker window
            overlap_start = max(window['start'], sentence_start)
            overlap_end = min(window['end'], sentence_end)
            
            if overlap_end > overlap_start:
                overlap_duration = (overlap_end - overlap_start).total_seconds()
                sentence_duration = (sentence_end - sentence_start).total_seconds()
                overlap_ratio = overlap_duration / sentence_duration if sentence_duration > 0 else 0
                
                if overlap_ratio > best_overlap:
                    best_overlap = overlap_ratio
                    best_window = window
        
        return best_window
    
    def calculate_confidence(self, speaker_window: Optional[Dict], sentence_start: datetime, 
                           sentence_end: datetime, total_speakers: int) -> float:
        """Calculate confidence score for speaker-sentence mapping"""
        
        if not speaker_window:
            return 0.3  # Unknown speaker
        
        # Calculate time overlap
        overlap_start = max(speaker_window['start'], sentence_start)
        overlap_end = min(speaker_window['end'], sentence_end)
        overlap_duration = (overlap_end - overlap_start).total_seconds()
        sentence_duration = (sentence_end - sentence_start).total_seconds()
        
        overlap_ratio = overlap_duration / sentence_duration if sentence_duration > 0 else 0
        
        # Base confidence from overlap
        if overlap_ratio > 0.8:
            base_confidence = 0.9
        elif overlap_ratio > 0.5:
            base_confidence = 0.7
        elif overlap_ratio > 0.2:
            base_confidence = 0.5
        else:
            base_confidence = 0.3
        
        # Adjust for speaker competition
        if total_speakers == 1:
            base_confidence += 0.05  # Boost for single speaker
        elif total_speakers > 3:
            base_confidence -= 0.1   # Reduce for complex conversations
            
        return min(base_confidence, 1.0)
    
    def save_speaker_transcript(self, segment: Dict, source_audio_chunk_id: UUID, meeting_id: str):
        """Save speaker transcript segment to database"""
        try:
            speaker_transcript = SpeakerTranscript(
                meeting_id=meeting_id,
                transcript_text=segment['transcript_text'],
                speaker_member_id=segment['speaker_member_id'],
                speaker_name=segment['speaker_name'],
                start_time=segment['start_time'],
                end_time=segment['end_time'],
                source_audio_chunk_id=source_audio_chunk_id,
                confidence_score=segment['confidence_score']
            )
            
            self.db.add(speaker_transcript)
            self.db.commit()
            self.db.refresh(speaker_transcript)
            
            print(f"💾 Speaker transcript saved: {segment['speaker_name']} - \"{segment['transcript_text'][:50]}...\" (confidence: {segment['confidence_score']:.2f})")
            
        except Exception as e:
            self.db.rollback()
            print(f"❌ Failed to save speaker transcript: {str(e)}")
            raise e
