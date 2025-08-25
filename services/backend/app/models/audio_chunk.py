from sqlalchemy import Column, String, LargeBinary, Boolean, DateTime, Integer, func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base


class AudioChunk(Base):
    __tablename__ = "audio_chunks"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)  # UUID primary key
    meeting_id = Column(String(2048), nullable=False, index=True)  # Meeting link/URL
    chunk_id = Column(Integer, nullable=False, index=True)         # Sequential chunk number per meeting  
    chunk_audio = Column(LargeBinary, nullable=True)               # Binary audio data
    chunk_transcript = Column(String, nullable=True)               # Transcript text
    transcription_status = Column(String(20), default="ready")    # Transcription status: ready, processed, failed
    host_email = Column(String(255), nullable=True)               # Meeting host email
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def __repr__(self):
        return f"<AudioChunk(id={self.id}, meeting_id={self.meeting_id}, chunk_id={self.chunk_id})>"
