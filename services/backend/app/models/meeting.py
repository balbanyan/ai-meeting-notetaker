from sqlalchemy import Column, String, Boolean, DateTime, func, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class Meeting(Base):
    __tablename__ = "meetings"
    
    # Primary Key - Internal unique identifier
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Webex Identifiers - webex_meeting_id is unique per meeting instance
    webex_meeting_id = Column(String(255), nullable=False, unique=True, index=True)
    meeting_number = Column(String(100), nullable=True, index=True)  # User-friendly numeric ID (e.g., "123 456 789")
    meeting_link = Column(String(2048), nullable=False, index=True)
    
    # Meeting Details from List Meetings API
    host_email = Column(String(255), nullable=True, index=True)
    participant_emails = Column(JSON, nullable=True)  # List of participant emails from List Meeting Participants API
    scheduled_start_time = Column(DateTime(timezone=True), nullable=True, index=True)
    scheduled_end_time = Column(DateTime(timezone=True), nullable=True)
    
    # Bot Participation Tracking
    actual_join_time = Column(DateTime(timezone=True), nullable=True)
    actual_leave_time = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=False, index=True)
    
    # Meeting Classification
    is_personal_room = Column(Boolean, default=False, index=True)
    meeting_type = Column(String(50), nullable=True)  # meeting/webinar
    scheduled_type = Column(String(50), nullable=True)  # meeting/webinar/personalRoomMeeting
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    audio_chunks = relationship("AudioChunk", back_populates="meeting")
    speaker_events = relationship("SpeakerEvent", back_populates="meeting")
    speaker_transcripts = relationship("SpeakerTranscript", back_populates="meeting")
    
    def __repr__(self):
        return f"<Meeting(id={self.id}, webex_meeting_id={self.webex_meeting_id}, host_email={self.host_email})>"

