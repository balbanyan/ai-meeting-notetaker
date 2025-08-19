from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.bot_client import get_bot_client, BotRunnerError, BotRunnerConnectionError, BotRunnerTimeoutError
from app.core.logger import get_logger
from app.models.entities import Meeting, Attendee
from pydantic import BaseModel
from datetime import datetime
import uuid

router = APIRouter()
logger = get_logger(__name__)


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
    bot_client = get_bot_client()
    meeting = None
    
    try:
        logger.info(f"Received join request for meeting: {request.webex_meeting_id}")
        
        # Check if meeting already exists
        existing_meeting = db.query(Meeting).filter(
            Meeting.webex_meeting_id == request.webex_meeting_id
        ).first()
        
        if existing_meeting:
            logger.info(f"Meeting {request.webex_meeting_id} already exists")
            return UserJoinMeetingResponse(
                meeting_id=existing_meeting.id,
                status="already_joined",
                message="Bot is already in this meeting"
            )
        
        # Create new meeting record with initial status
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
        
        logger.info(f"Created meeting record: {meeting.id}")
        
        # Check bot-runner health before attempting to join
        try:
            logger.info("Checking bot-runner health...")
            is_healthy = await bot_client.health_check()
            if not is_healthy:
                raise BotRunnerConnectionError("Bot-runner is not healthy")
            logger.info("Bot-runner is healthy")
            
        except Exception as health_error:
            logger.error(f"Bot-runner health check failed: {health_error}")
            meeting.status = "error"
            meeting.end_time = datetime.utcnow()
            db.commit()
            raise HTTPException(
                status_code=503,
                detail="Bot service is currently unavailable. Please try again later."
            )
        
        # Request bot-runner to join the meeting
        try:
            logger.info(f"Requesting bot-runner to join meeting: {request.webex_meeting_id}")
            bot_response = await bot_client.join_meeting(
                meeting_url=request.webex_meeting_id,
                title=request.title,
                host_email=request.host_email
            )
            
            if bot_response.success:
                # Update meeting status to active
                meeting.status = "active"
                db.commit()
                
                logger.info(f"Bot successfully joined meeting: {meeting.id}")
                return UserJoinMeetingResponse(
                    meeting_id=meeting.id,
                    status="joined",
                    message="Bot successfully joined the meeting"
                )
            else:
                # Bot join failed
                meeting.status = "error"
                meeting.end_time = datetime.utcnow()
                db.commit()
                
                error_msg = bot_response.message or "Unknown error"
                logger.error(f"Bot join failed: {error_msg}")
                raise HTTPException(
                    status_code=422,
                    detail=f"Failed to join meeting: {error_msg}"
                )
                
        except BotRunnerConnectionError:
            logger.error("Bot-runner connection failed")
            meeting.status = "error"
            meeting.end_time = datetime.utcnow()
            db.commit()
            raise HTTPException(
                status_code=503,
                detail="Bot service is currently unavailable. Please try again later."
            )
            
        except BotRunnerTimeoutError:
            logger.error("Bot-runner request timed out")
            meeting.status = "error"
            meeting.end_time = datetime.utcnow()
            db.commit()
            raise HTTPException(
                status_code=504,
                detail="Bot service request timed out. Please try again later."
            )
            
        except BotRunnerError as e:
            logger.error(f"Bot-runner error: {e}")
            meeting.status = "error"
            meeting.end_time = datetime.utcnow()
            db.commit()
            raise HTTPException(
                status_code=422,
                detail=f"Failed to join meeting: {str(e)}"
            )
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error in user_join_meeting: {e}")
        if meeting:
            db.rollback()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/meetings/{meeting_id}/leave")
async def user_leave_meeting(
    meeting_id: UUID,
    db: Session = Depends(get_db)
):
    """User-facing endpoint to request bot to leave a meeting"""
    bot_client = get_bot_client()
    
    try:
        logger.info(f"Received leave request for meeting: {meeting_id}")
        
        # Find the meeting
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        
        # Check if meeting is active
        if meeting.status != "active":
            logger.warning(f"Attempted to leave non-active meeting: {meeting_id} (status: {meeting.status})")
            return {
                "meeting_id": meeting_id, 
                "status": "already_ended", 
                "message": "Meeting is not currently active"
            }
        
        # Request bot-runner to leave the meeting
        try:
            logger.info(f"Requesting bot-runner to leave meeting: {meeting_id}")
            bot_response = await bot_client.leave_meeting()
            
            if bot_response.success:
                # Update meeting status to ended
                meeting.status = "ended"
                meeting.end_time = datetime.utcnow()
                db.commit()
                
                logger.info(f"Bot successfully left meeting: {meeting_id}")
                return {
                    "meeting_id": meeting_id,
                    "status": "left",
                    "message": "Bot successfully left the meeting"
                }
            else:
                # Bot leave failed, but still update database
                meeting.status = "ended"
                meeting.end_time = datetime.utcnow()
                db.commit()
                
                error_msg = bot_response.message or "Unknown error"
                logger.warning(f"Bot leave warning: {error_msg}, but meeting marked as ended")
                return {
                    "meeting_id": meeting_id,
                    "status": "left",
                    "message": f"Meeting ended (with warning: {error_msg})"
                }
                
        except BotRunnerError as e:
            logger.warning(f"Bot-runner error during leave: {e}, but marking meeting as ended")
            # Even if bot-runner fails, mark meeting as ended
            meeting.status = "ended"
            meeting.end_time = datetime.utcnow()
            db.commit()
            
            return {
                "meeting_id": meeting_id,
                "status": "left",
                "message": f"Meeting ended (bot service error: {str(e)})"
            }
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error in user_leave_meeting: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
