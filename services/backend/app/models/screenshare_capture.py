from sqlalchemy import Column, String, LargeBinary, Text, DateTime, Integer, func, ForeignKey
from sqlalchemy.types import Uuid
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class ScreenshareCapture(Base):
    __tablename__ = "screenshare_captures"
    
    id = Column(Uuid(), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(Uuid(), ForeignKey('meetings.id'), nullable=False, index=True)
    audio_chunk_id = Column(Uuid(), ForeignKey('audio_chunks.id'), nullable=False, index=True)
    chunk_id = Column(Integer, nullable=False, index=True)  # Sequential reference, same as audio chunk
    
    # Screenshot data
    screenshot_image = Column(LargeBinary, nullable=False)  # PNG image data
    image_format = Column(String(10), default='png')  # 'png' or 'jpeg'
    
    # Vision model analysis
    vision_analysis = Column(Text, nullable=True)  # LLM description of screenshot
    vision_model_used = Column(String(100), nullable=True)  # e.g., 'meta-llama/llama-4-scout-17b-16e-instruct'
    analysis_status = Column(String(20), default='pending')  # pending, processing, completed, failed
    
    # Timing (inherited from audio chunk)
    captured_at = Column(DateTime(timezone=True), nullable=False, index=True)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="screenshare_captures")
    audio_chunk = relationship("AudioChunk", back_populates="screenshare_captures")
    
    def __repr__(self):
        return f"<ScreenshareCapture(id={self.id}, meeting_id={self.meeting_id}, chunk_id={self.chunk_id})>"
