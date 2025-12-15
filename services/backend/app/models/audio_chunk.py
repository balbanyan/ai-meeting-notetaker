from sqlalchemy import Column, String, LargeBinary, Boolean, DateTime, Integer, func, ForeignKey, Index
from sqlalchemy.types import Uuid
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class AudioChunk(Base):
    __tablename__ = "audio_chunks"
    
    id = Column(Uuid(), primary_key=True, default=uuid.uuid4)  # UUID primary key
    meeting_id = Column(Uuid(), ForeignKey('meetings.id'), nullable=False, index=True)  # Foreign key to meetings table
    chunk_id = Column(Integer, nullable=False, index=True)         # Sequential chunk number per meeting  
    chunk_audio = Column(LargeBinary, nullable=True)               # Binary audio data
    chunk_transcript = Column(String, nullable=True)               # Transcript text
    transcription_status = Column(String(20), default="ready")    # Transcription status: ready, processing, completed, failed
    host_email = Column(String(255), nullable=True)               # Meeting host email
    
    # Actual audio timing
    audio_started_at = Column(DateTime(timezone=True), nullable=True)  # When audio recording started
    audio_ended_at = Column(DateTime(timezone=True), nullable=True)    # When audio recording ended
    
    # Processing timing
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="audio_chunks")
    speaker_transcripts = relationship("SpeakerTranscript", back_populates="source_audio_chunk")
    screenshare_captures = relationship("ScreenshareCapture", back_populates="audio_chunk")
    
    # Composite indexes for common query patterns
    __table_args__ = (
        # Query: Get pending/processing chunks for a meeting
        Index('idx_audio_meeting_status', 'meeting_id', 'transcription_status'),
        # Query: Get chunks in order for a meeting
        Index('idx_audio_meeting_chunk', 'meeting_id', 'chunk_id'),
    )
    
    def __repr__(self):
        return f"<AudioChunk(id={self.id}, meeting_id={self.meeting_id}, chunk_id={self.chunk_id})>"
