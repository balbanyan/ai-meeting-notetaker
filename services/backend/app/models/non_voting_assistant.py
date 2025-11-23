from sqlalchemy import Column, String, Integer, DateTime, func, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from app.core.database import Base


class NonVotingAssistantResponse(Base):
    __tablename__ = "non_voting_assistant_responses"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey('meetings.id'), nullable=False, index=True)
    triggered_at_chunk_id = Column(Integer, nullable=False)
    
    # Input summary
    transcript_count = Column(Integer)
    unique_slide_count = Column(Integer)
    screenshot_ids = Column(JSON)  # Array of screenshot UUIDs used in this checkpoint
    
    # API response (JSON columns)
    suggested_questions = Column(JSON)  # ["Q1", "Q2", ...]
    quotes = Column(JSON)  # [{"quote": "...", "person": "..."}, ...]
    engagement_points = Column(JSON)  # ["E1", "E2", ...]
    non_voting_opinions = Column(JSON)  # ["O1", "O2", ...]
    
    # Metadata
    api_response_status = Column(String(20), default='pending')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="non_voting_responses")
    
    def __repr__(self):
        return f"<NonVotingAssistantResponse(id={self.id}, meeting_id={self.meeting_id}, chunk={self.triggered_at_chunk_id})>"

