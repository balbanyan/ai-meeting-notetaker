from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.core.config import settings
from app.models.entities import Meeting, Attendee
from pydantic import BaseModel

router = APIRouter()


# Pydantic models
class JoinMeetingRequest(BaseModel):
    webex_meeting_id: str
    title: Optional[str] = None
    host_email: Optional[str] = None


class LeaveMeetingRequest(BaseModel):
    meeting_id: UUID


class JoinMeetingResponse(BaseModel):
    meeting_id: UUID
    status: str
    message: str


class LeaveMeetingResponse(BaseModel):
    meeting_id: UUID
    status: str
    message: str


def verify_bot_token(authorization: str = Header(...)):
    """Verify bot service token"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    if token != settings.BOT_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bot service token")
    
    return token


@router.post("/bot/join", response_model=JoinMeetingResponse)
async def bot_join_meeting(
    request: JoinMeetingRequest,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """Bot endpoint to join a meeting and create meeting record"""
    try:
        # Check if meeting already exists
        existing_meeting = db.query(Meeting).filter(
            Meeting.webex_meeting_id == request.webex_meeting_id
        ).first()
        
        if existing_meeting:
            return JoinMeetingResponse(
                meeting_id=existing_meeting.id,
                status="already_exists",
                message="Meeting already exists in database"
            )
        
        # Create new meeting record
        meeting = Meeting(
            webex_meeting_id=request.webex_meeting_id,
            title=request.title,
            host_email=request.host_email,
            start_time=datetime.utcnow(),
            status="active"
        )
        
        db.add(meeting)
        db.commit()
        db.refresh(meeting)
        
        return JoinMeetingResponse(
            meeting_id=meeting.id,
            status="joined",
            message="Bot successfully joined meeting"
        )
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to join meeting: {str(e)}")


@router.post("/bot/leave", response_model=LeaveMeetingResponse)
async def bot_leave_meeting(
    request: LeaveMeetingRequest,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """Bot endpoint to leave a meeting and update meeting record"""
    try:
        # Find the meeting
        meeting = db.query(Meeting).filter(Meeting.id == request.meeting_id).first()
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        
        # Update meeting status
        meeting.end_time = datetime.utcnow()
        meeting.status = "ended"
        
        db.commit()
        
        # Trigger summary generation for the completed meeting
        from app.core.queue import enqueue_job
        from app.workers.summary_worker import generate_all_summary_types
        
        summary_job = enqueue_job(
            'summary',
            generate_all_summary_types,
            str(meeting.id)
        )
        
        return LeaveMeetingResponse(
            meeting_id=meeting.id,
            status="left",
            message="Bot successfully left meeting. Summary generation started."
        )
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to leave meeting: {str(e)}")


@router.post("/bot/attendees/{meeting_id}")
async def update_attendees(
    meeting_id: UUID,
    attendees: list,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """Update meeting attendees list"""
    try:
        # Verify meeting exists
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        
        # Process attendees list
        for attendee_data in attendees:
            # Check if attendee already exists
            existing_attendee = db.query(Attendee).filter(
                Attendee.meeting_id == meeting_id,
                Attendee.email == attendee_data.get("email")
            ).first()
            
            if not existing_attendee:
                attendee = Attendee(
                    meeting_id=meeting_id,
                    email=attendee_data.get("email"),
                    name=attendee_data.get("name"),
                    webex_user_id=attendee_data.get("webex_user_id"),
                    is_host=attendee_data.get("is_host", False),
                    joined_at=datetime.utcnow()
                )
                db.add(attendee)
        
        db.commit()
        
        return {"status": "success", "message": "Attendees updated"}
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update attendees: {str(e)}")
