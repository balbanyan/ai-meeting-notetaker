from sqlalchemy import Column, String, Boolean, DateTime, func, JSON, Text, Integer, Index
from sqlalchemy.types import Uuid
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class Meeting(Base):
    __tablename__ = "meetings"
    
    # Primary Key - Internal unique identifier
    id = Column(Uuid(), primary_key=True, default=uuid.uuid4)
    
    # Webex Identifiers
    # webex_meeting_id: Unique per session. For personal rooms, includes timestamp suffix (e.g., "abc123_20251211T163000Z")
    webex_meeting_id = Column(String(255), nullable=False, unique=True, index=True)
    original_webex_meeting_id = Column(String(255), nullable=True, index=True)  # Original Webex meeting ID without timestamp (meetingSeriesId for scheduled meetings)
    meeting_number = Column(String(100), nullable=True, index=True)  # User-friendly numeric ID (e.g., "123 456 789")
    meeting_link = Column(String(2048), nullable=False, index=True)  # NOT unique - personal rooms share same link
    meeting_title = Column(String(500), nullable=True)  # Meeting title from Webex API
    
    # Meeting Details from List Meetings API
    host_email = Column(String(255), nullable=True, index=True)
    participant_emails = Column(JSON, nullable=True)  # List of participant emails (non-cohosts only)
    cohost_emails = Column(JSON, default=list)  # List of cohost emails (separate from participants)
    scheduled_start_time = Column(DateTime(timezone=True), nullable=True, index=True)
    scheduled_end_time = Column(DateTime(timezone=True), nullable=True)
    
    # Bot Participation Tracking
    actual_join_time = Column(DateTime(timezone=True), nullable=True)
    actual_leave_time = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=False, index=True)
    
    # Meeting Classification
    meeting_type = Column(String(50), nullable=True)  # "meeting", "webinar", "personalRoomMeeting", "scheduledMeeting" (from meetingType)
    scheduled_type = Column(String(50), nullable=True)  # "meeting", "webinar", "personalRoomMeeting" (from scheduledType)
    
    # AI-Generated Content
    meeting_summary = Column(Text, nullable=True)  # LLM-generated meeting summary (MoM)
    
    # Feature Flags
    screenshots_enabled = Column(Boolean, default=False, index=True)  # Whether screenshots were enabled for this meeting
    non_voting_enabled = Column(Boolean, default=False, index=True)  # Whether non-voting assistant is enabled for this meeting
    non_voting_call_frequency = Column(Integer, default=20)  # Chunks between non-voting assistant calls
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    audio_chunks = relationship("AudioChunk", back_populates="meeting")
    speaker_events = relationship("SpeakerEvent", back_populates="meeting")
    speaker_transcripts = relationship("SpeakerTranscript", back_populates="meeting")
    screenshare_captures = relationship("ScreenshareCapture", back_populates="meeting")
    non_voting_responses = relationship("NonVotingAssistantResponse", back_populates="meeting")
    
    # Composite indexes for common query patterns
    __table_args__ = (
        # Query: Find active meetings (for dashboard)
        Index('idx_meeting_active_join', 'is_active', 'actual_join_time'),
        # Query: Lookup meeting by webex ID and check if active
        Index('idx_meeting_webex_active', 'webex_meeting_id', 'is_active'),
    )
    
    def __repr__(self):
        return f"<Meeting(id={self.id}, webex_meeting_id={self.webex_meeting_id}, host_email={self.host_email})>"

