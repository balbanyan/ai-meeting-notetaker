from sqlalchemy import Column, String, DateTime, func, ForeignKey
from sqlalchemy.types import Uuid
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class SpeakerEvent(Base):
    __tablename__ = "speaker_events"
    
    id = Column(Uuid(), primary_key=True, default=uuid.uuid4)  # UUID primary key
    meeting_id = Column(Uuid(), ForeignKey('meetings.id'), nullable=False, index=True)  # Foreign key to meetings table
    member_id = Column(String(255), nullable=True, index=True)     # Webex member ID
    member_name = Column(String(255), nullable=True)              # Display name if available  
    speaker_started_at = Column(DateTime(timezone=True), nullable=False)  # When speaker started speaking (same format as audio_chunks)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationship
    meeting = relationship("Meeting", back_populates="speaker_events")
    
    def __repr__(self):
        return f"<SpeakerEvent(id={self.id}, meeting_id={self.meeting_id}, member_name={self.member_name})>"
