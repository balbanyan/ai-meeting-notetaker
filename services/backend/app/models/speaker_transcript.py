from sqlalchemy import Column, String, Text, Float, DateTime, func, ForeignKey
from sqlalchemy.types import Uuid
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class SpeakerTranscript(Base):
    __tablename__ = "speaker_transcripts"
    
    id = Column(Uuid(), primary_key=True, default=uuid.uuid4)  # UUID primary key
    meeting_id = Column(Uuid(), ForeignKey('meetings.id'), nullable=False, index=True)  # Foreign key to meetings table
    transcript_text = Column(Text, nullable=False)                 # Transcript segment for this speaker
    speaker_member_id = Column(String(255), nullable=True, index=True)     # Member ID from speaker_events
    speaker_name = Column(String(255), nullable=True)             # Member name for easy reference
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)  # When this segment starts
    end_time = Column(DateTime(timezone=True), nullable=False)     # When this segment ends
    source_audio_chunk_id = Column(Uuid(), ForeignKey('audio_chunks.id'), nullable=False)  # Reference to original audio_chunk
    confidence_score = Column(Float, nullable=False, default=0.5) # Mapping confidence (0.0-1.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="speaker_transcripts")
    source_audio_chunk = relationship("AudioChunk", back_populates="speaker_transcripts")
    
    def __repr__(self):
        return f"<SpeakerTranscript(id={self.id}, speaker_name={self.speaker_name}, confidence={self.confidence_score})>"
