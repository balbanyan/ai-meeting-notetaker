from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.models.entities import TranscriptSegment
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()


# Pydantic models
class TranscriptSegmentResponse(BaseModel):
    id: UUID
    speaker_name: Optional[str]
    speaker_email: Optional[str]
    text: str
    start_ms: int
    end_ms: int
    confidence: Optional[float]
    language: str
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/meetings/{meeting_id}/transcript", response_model=List[TranscriptSegmentResponse])
async def get_meeting_transcript(
    meeting_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    start_time_ms: Optional[int] = Query(None),
    end_time_ms: Optional[int] = Query(None),
    speaker_email: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Get transcript segments for a meeting with pagination and filtering"""
    
    query = db.query(TranscriptSegment).filter(
        TranscriptSegment.meeting_id == meeting_id
    )
    
    # Apply filters
    if start_time_ms is not None:
        query = query.filter(TranscriptSegment.start_ms >= start_time_ms)
    
    if end_time_ms is not None:
        query = query.filter(TranscriptSegment.end_ms <= end_time_ms)
    
    if speaker_email:
        query = query.filter(TranscriptSegment.speaker_email == speaker_email)
    
    # Order by start time
    query = query.order_by(TranscriptSegment.start_ms)
    
    # Apply pagination
    segments = query.offset(skip).limit(limit).all()
    
    return segments


@router.get("/meetings/{meeting_id}/transcript/stats")
async def get_transcript_stats(meeting_id: UUID, db: Session = Depends(get_db)):
    """Get transcript statistics for a meeting"""
    
    # Total segments
    total_segments = db.query(TranscriptSegment).filter(
        TranscriptSegment.meeting_id == meeting_id
    ).count()
    
    if total_segments == 0:
        return {
            "meeting_id": meeting_id,
            "total_segments": 0,
            "total_duration_ms": 0,
            "speakers": [],
            "language_distribution": {}
        }
    
    # Get duration
    duration_result = db.query(
        db.func.max(TranscriptSegment.end_ms) - db.func.min(TranscriptSegment.start_ms)
    ).filter(TranscriptSegment.meeting_id == meeting_id).scalar()
    
    # Get unique speakers
    speakers = db.query(TranscriptSegment.speaker_email).filter(
        TranscriptSegment.meeting_id == meeting_id,
        TranscriptSegment.speaker_email.isnot(None)
    ).distinct().all()
    speaker_list = [s[0] for s in speakers if s[0]]
    
    # Get language distribution
    languages = db.query(
        TranscriptSegment.language,
        db.func.count(TranscriptSegment.id)
    ).filter(
        TranscriptSegment.meeting_id == meeting_id
    ).group_by(TranscriptSegment.language).all()
    
    language_distribution = {lang: count for lang, count in languages}
    
    return {
        "meeting_id": meeting_id,
        "total_segments": total_segments,
        "total_duration_ms": duration_result or 0,
        "speakers": speaker_list,
        "language_distribution": language_distribution
    }


@router.get("/meetings/{meeting_id}/transcript/search")
async def search_transcript(
    meeting_id: UUID,
    q: str = Query(..., description="Search query"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Search transcript content using full-text search"""
    
    # Use PostgreSQL full-text search
    query = db.query(TranscriptSegment).filter(
        TranscriptSegment.meeting_id == meeting_id,
        TranscriptSegment.text.op('@@')(db.func.plainto_tsquery('english', q))
    ).order_by(TranscriptSegment.start_ms)
    
    segments = query.offset(skip).limit(limit).all()
    
    return {
        "query": q,
        "meeting_id": meeting_id,
        "results": [
            {
                "id": segment.id,
                "text": segment.text,
                "speaker_name": segment.speaker_name,
                "speaker_email": segment.speaker_email,
                "start_ms": segment.start_ms,
                "end_ms": segment.end_ms,
                "created_at": segment.created_at
            }
            for segment in segments
        ]
    }
