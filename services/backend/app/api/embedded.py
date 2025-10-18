from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid
import httpx

from app.core.config import settings
from app.core.database import get_db
from app.models.meeting import Meeting
from app.models.audio_chunk import AudioChunk

router = APIRouter()


class RegisterAndJoinRequest(BaseModel):
    meeting_id: str  # Webex meeting ID from SDK
    meeting_title: str
    start_time: str  # ISO format
    end_time: str  # ISO format
    meeting_type: str
    meeting_url: str  # Meeting URL for bot join


class RegisterAndJoinResponse(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    status: str
    message: str


@router.post("/embedded/register-and-join", response_model=RegisterAndJoinResponse)
async def register_and_join_meeting(
    request: RegisterAndJoinRequest,
    db: Session = Depends(get_db)
):
    """
    Register meeting from embedded app and trigger bot join.
    
    Workflow:
    1. Receive meeting metadata from Webex Embedded App SDK
    2. Call Webex API to get participant emails
    3. Extract host email from participants
    4. Create/update meeting record in database
    5. Trigger bot join via bot-runner
    6. Return success response
    """
    try:
        print(f"📱 EMBEDDED APP - Register and Join Request")
        print(f"   Meeting ID: {request.meeting_id}")
        print(f"   Title: {request.meeting_title}")
        
        # Initialize Webex API client
        from app.services.webex_api import WebexMeetingsAPI
        webex_api = WebexMeetingsAPI(
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            refresh_token=settings.webex_refresh_token,
            personal_token=settings.webex_personal_access_token
        )
        
        # Get participant emails and host from Webex API
        print(f"🌐 Fetching participants for meeting {request.meeting_id}...")
        participant_data = await webex_api.get_meeting_participants_with_host(request.meeting_id)
        
        participant_emails = participant_data.get("participant_emails", [])
        host_email = participant_data.get("host_email")
        
        print(f"✅ Found {len(participant_emails)} participants")
        if host_email:
            print(f"   Host: {host_email}")
        
        # Parse datetime strings
        scheduled_start = None
        scheduled_end = None
        try:
            scheduled_start = datetime.fromisoformat(request.start_time.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            print(f"⚠️ Could not parse start_time: {request.start_time}")
        
        try:
            scheduled_end = datetime.fromisoformat(request.end_time.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            print(f"⚠️ Could not parse end_time: {request.end_time}")
        
        # Check if meeting already exists
        existing_meeting = db.query(Meeting).filter(
            Meeting.webex_meeting_id == request.meeting_id
        ).first()
        
        if existing_meeting:
            # Update existing meeting
            print(f"🔄 Meeting exists - updating (UUID: {existing_meeting.id})")
            
            existing_meeting.is_active = True
            existing_meeting.actual_join_time = datetime.utcnow()
            existing_meeting.participant_emails = participant_emails
            existing_meeting.host_email = host_email
            existing_meeting.meeting_link = request.meeting_url
            
            # Update scheduled times if provided
            if scheduled_start:
                existing_meeting.scheduled_start_time = scheduled_start
            if scheduled_end:
                existing_meeting.scheduled_end_time = scheduled_end
            
            db.commit()
            db.refresh(existing_meeting)
            
            meeting_uuid = str(existing_meeting.id)
        else:
            # Create new meeting record
            print(f"🆕 Creating new meeting record")
            
            new_meeting = Meeting(
                webex_meeting_id=request.meeting_id,
                meeting_number=None,  # SDK doesn't provide meeting number
                meeting_link=request.meeting_url,
                host_email=host_email,
                participant_emails=participant_emails,
                scheduled_start_time=scheduled_start,
                scheduled_end_time=scheduled_end,
                actual_join_time=datetime.utcnow(),
                is_active=True,
                is_personal_room=False,  # SDK doesn't provide this info
                meeting_type=request.meeting_type,
                scheduled_type=None  # SDK doesn't provide scheduled_type
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            
            meeting_uuid = str(new_meeting.id)
            print(f"✅ Meeting created - UUID: {meeting_uuid}")
        
        # Trigger bot join via bot-runner
        print(f"🤖 Triggering bot join...")
        bot_runner_url = f"{settings.bot_runner_url}/join"
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                bot_response = await client.post(
                    bot_runner_url,
                    json={"meetingUrl": request.meeting_url},
                    headers={"Content-Type": "application/json"}
                )
                
                if bot_response.status_code == 200:
                    bot_data = bot_response.json()
                    
                    if bot_data.get("success"):
                        print(f"✅ Bot successfully triggered to join")
                        
                        return RegisterAndJoinResponse(
                            meeting_uuid=meeting_uuid,
                            webex_meeting_id=request.meeting_id,
                            status="success",
                            message="Meeting registered and bot join triggered successfully"
                        )
                    else:
                        error_msg = bot_data.get("error", "Unknown error from bot-runner")
                        print(f"❌ Bot failed to join: {error_msg}")
                        raise HTTPException(status_code=500, detail=f"Bot failed to join: {error_msg}")
                else:
                    print(f"❌ Bot-runner API error: {bot_response.status_code}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Bot-runner API error: {bot_response.status_code}"
                    )
        
        except httpx.TimeoutException:
            print("❌ Bot-runner API timeout")
            raise HTTPException(status_code=504, detail="Bot-runner service timeout")
        except httpx.ConnectError:
            print("❌ Bot-runner connection failed")
            raise HTTPException(status_code=503, detail="Bot-runner service unavailable")
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ EMBEDDED REGISTER FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to register meeting: {str(e)}")

