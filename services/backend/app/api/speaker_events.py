from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.core.database import get_db
from app.core.auth import verify_bot_token
from app.models.speaker_event import SpeakerEvent

router = APIRouter()


class SpeakerEventRequest(BaseModel):
    meeting_id: str
    member_id: Optional[str] = None
    member_name: Optional[str] = None
    speaker_started_at: datetime


class SpeakerEventResponse(BaseModel):
    status: str
    message: str


@router.post("/events/speaker-started", response_model=SpeakerEventResponse)
async def save_speaker_started_event(
    event_data: SpeakerEventRequest,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """Save a speaker started event"""
    try:
        speaker_event = SpeakerEvent(
            meeting_id=event_data.meeting_id,
            member_id=event_data.member_id,
            member_name=event_data.member_name,
            speaker_started_at=event_data.speaker_started_at
        )
        
        db.add(speaker_event)
        db.commit()
        db.refresh(speaker_event)
        
        print(f"🗣️ SPEAKER EVENT SAVED - Member: {event_data.member_name or event_data.member_id}, Time: {event_data.speaker_started_at}")
        
        return SpeakerEventResponse(
            status="saved",
            message="Speaker event recorded successfully"
        )
        
    except Exception as e:
        db.rollback()
        print(f"❌ SPEAKER EVENT SAVE FAILED - {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save speaker event: {str(e)}")
