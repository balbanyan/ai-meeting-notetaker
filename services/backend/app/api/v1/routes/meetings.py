from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.models.entities import Meeting, Attendee
from pydantic import BaseModel
from datetime import datetime
import uuid

router = APIRouter()


# Pydantic models
class MeetingResponse(BaseModel):
    id: UUID
    webex_meeting_id: str
    title: Optional[str]
    host_email: Optional[str]
    start_time: datetime
    end_time: Optional[datetime]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class AttendeeResponse(BaseModel):
    id: UUID
    email: Optional[str]
    name: Optional[str]
    is_host: bool
    joined_at: Optional[datetime]
    left_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/meetings", response_model=List[MeetingResponse])
async def list_meetings(
    skip: int = 0,
    limit: int = 100,
    user_email: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List meetings, optionally filtered by user email"""
    query = db.query(Meeting)
    
    if user_email:
        # Filter by meetings where user was an attendee
        query = query.join(Attendee).filter(Attendee.email == user_email)
    
    meetings = query.offset(skip).limit(limit).all()
    return meetings


@router.get("/meetings/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(meeting_id: UUID, db: Session = Depends(get_db)):
    """Get a specific meeting by ID"""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.get("/meetings/{meeting_id}/attendees", response_model=List[AttendeeResponse])
async def get_meeting_attendees(meeting_id: UUID, db: Session = Depends(get_db)):
    """Get attendees for a specific meeting"""
    # Check if meeting exists
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    attendees = db.query(Attendee).filter(Attendee.meeting_id == meeting_id).all()
    return attendees


# User-facing meeting management endpoints (no bot auth required)
class UserJoinMeetingRequest(BaseModel):
    webex_meeting_id: str
    title: Optional[str] = None
    host_email: Optional[str] = None


class UserJoinMeetingResponse(BaseModel):
    meeting_id: UUID
    status: str
    message: str


@router.post("/meetings/join", response_model=UserJoinMeetingResponse)
async def user_join_meeting(
    request: UserJoinMeetingRequest,
    db: Session = Depends(get_db)
):
    """User-facing endpoint to request bot to join a meeting"""
    try:
        # Create or get existing meeting
        existing_meeting = db.query(Meeting).filter(
            Meeting.webex_meeting_id == request.webex_meeting_id
        ).first()
        
        if existing_meeting:
            return UserJoinMeetingResponse(
                meeting_id=existing_meeting.id,
                status="already_joined",
                message="Bot is already in this meeting"
            )
        
        # Create new meeting record
        meeting = Meeting(
            id=uuid.uuid4(),
            webex_meeting_id=request.webex_meeting_id,
            title=request.title,
            host_email=request.host_email,
            start_time=datetime.utcnow(),
            status="joining"
        )
        db.add(meeting)
        db.commit()
        db.refresh(meeting)
        
        # TODO: Here we would normally trigger the bot-runner to actually join
        # For now, just return success
        
        return UserJoinMeetingResponse(
            meeting_id=meeting.id,
            status="joining",
            message="Bot join request submitted successfully"
        )
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to join meeting: {str(e)}")


@router.post("/meetings/{meeting_id}/leave")
async def user_leave_meeting(
    meeting_id: UUID,
    db: Session = Depends(get_db)
):
    """User-facing endpoint to request bot to leave a meeting"""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    meeting.status = "ended"
    meeting.end_time = datetime.utcnow()
    db.commit()
    
    return {"meeting_id": meeting_id, "status": "left", "message": "Bot left meeting successfully"}
