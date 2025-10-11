from sqlalchemy import Column, String, LargeBinary, Boolean, DateTime, Integer, func, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class AudioChunk(Base):
    __tablename__ = "audio_chunks"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)  # UUID primary key
    meeting_id = Column(UUID(as_uuid=True), ForeignKey('meetings.id'), nullable=False, index=True)  # Foreign key to meetings table
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
    
    def __repr__(self):
        return f"<AudioChunk(id={self.id}, meeting_id={self.meeting_id}, chunk_id={self.chunk_id})>"
