from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
import uuid

from app.core.database import Base


class Meeting(Base):
    __tablename__ = "meetings"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    webex_meeting_id = Column(String(255), unique=True, nullable=False, index=True)
    title = Column(String(500), nullable=True)
    host_email = Column(String(255), nullable=True)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(50), default="active")  # active, ended, error
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    attendees = relationship("Attendee", back_populates="meeting", cascade="all, delete-orphan")
    transcript_segments = relationship("TranscriptSegment", back_populates="meeting", cascade="all, delete-orphan")
    summaries = relationship("Summary", back_populates="meeting", cascade="all, delete-orphan")
    doc_chunks = relationship("DocChunk", back_populates="meeting", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_meeting_webex_id', 'webex_meeting_id'),
        Index('idx_meeting_status_start', 'status', 'start_time'),
    )


class Attendee(Base):
    __tablename__ = "attendees"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)
    email = Column(String(255), nullable=True)
    name = Column(String(255), nullable=True)
    webex_user_id = Column(String(255), nullable=True)
    joined_at = Column(DateTime(timezone=True), nullable=True)
    left_at = Column(DateTime(timezone=True), nullable=True)
    is_host = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="attendees")

    __table_args__ = (
        Index('idx_attendee_meeting_id', 'meeting_id'),
        Index('idx_attendee_email', 'email'),
        Index('idx_attendee_meeting_email', 'meeting_id', 'email'),
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)
    speaker_name = Column(String(255), nullable=True)
    speaker_email = Column(String(255), nullable=True)
    text = Column(Text, nullable=False)
    start_ms = Column(Integer, nullable=False)  # Start time in milliseconds
    end_ms = Column(Integer, nullable=False)    # End time in milliseconds
    confidence = Column(Float, nullable=True)   # Transcription confidence
    language = Column(String(10), default="en")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="transcript_segments")

    __table_args__ = (
        Index('idx_transcript_meeting_id', 'meeting_id'),
        Index('idx_transcript_meeting_time', 'meeting_id', 'start_ms'),
        Index('idx_transcript_speaker', 'speaker_email'),
    )


class Summary(Base):
    __tablename__ = "summaries"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)
    summary_type = Column(String(50), nullable=False)  # bullet_points, decisions, narrative
    content = Column(Text, nullable=False)
    version = Column(Integer, default=1)
    generated_by = Column(String(50), nullable=False)  # groq-llm, openai-gpt4, etc.
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="summaries")

    __table_args__ = (
        Index('idx_summary_meeting_id', 'meeting_id'),
        Index('idx_summary_meeting_type', 'meeting_id', 'summary_type'),
    )


class DocChunk(Base):
    __tablename__ = "doc_chunks"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id = Column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)
    chunk_type = Column(String(50), nullable=False)  # transcript, summary
    content = Column(Text, nullable=False)
    start_ms = Column(Integer, nullable=True)  # For transcript chunks
    end_ms = Column(Integer, nullable=True)    # For transcript chunks
    embedding = Column(Vector(1536), nullable=True)  # OpenAI embedding size
    chunk_metadata = Column(Text, nullable=True)  # JSON metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    meeting = relationship("Meeting", back_populates="doc_chunks")

    __table_args__ = (
        Index('idx_doc_chunk_meeting_id', 'meeting_id'),
        Index('idx_doc_chunk_type', 'chunk_type'),
        Index('idx_doc_chunk_meeting_time', 'meeting_id', 'start_ms'),
        # Vector similarity search index
        Index('idx_doc_chunk_embedding', 'embedding', postgresql_using='ivfflat', 
              postgresql_with={'lists': 100}),
    )


# Optional tables for future use
class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type = Column(String(100), nullable=False)
    webex_meeting_id = Column(String(255), nullable=True)
    payload = Column(Text, nullable=False)  # JSON payload
    processed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index('idx_webhook_event_type', 'event_type'),
        Index('idx_webhook_meeting_id', 'webex_meeting_id'),
        Index('idx_webhook_processed', 'processed'),
    )


class JobRun(Base):
    __tablename__ = "job_runs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_type = Column(String(50), nullable=False)  # stt, summary, embedding
    meeting_id = Column(UUID(as_uuid=True), nullable=True)
    status = Column(String(50), default="pending")  # pending, running, completed, failed
    input_data = Column(Text, nullable=True)  # JSON input
    output_data = Column(Text, nullable=True)  # JSON output
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index('idx_job_run_type', 'job_type'),
        Index('idx_job_run_status', 'status'),
        Index('idx_job_run_meeting', 'meeting_id'),
    )
