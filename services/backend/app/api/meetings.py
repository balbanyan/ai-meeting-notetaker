from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid
import httpx
import asyncio
from app.core.config import settings
from app.core.database import get_db
from app.core.auth import verify_bot_token
from app.models.meeting import Meeting
from app.models.audio_chunk import AudioChunk

router = APIRouter()


class JoinMeetingRequest(BaseModel):
    meeting_url: str
    host_name: str = None


class JoinMeetingResponse(BaseModel):
    meeting_id: str
    status: str
    message: str


@router.post("/meetings/join", response_model=JoinMeetingResponse)
async def join_meeting(request: JoinMeetingRequest):
    """Trigger bot to join a meeting via headless bot-runner"""
    try:
        print(f"🚀 JOIN REQUEST received")
        
        # Call the headless bot-runner API
        bot_runner_url = f"{settings.bot_runner_url}/join"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                bot_runner_url,
                json={"meetingUrl": request.meeting_url},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                bot_response = response.json()
                
                if bot_response.get("success"):
                    meeting_id = bot_response.get("meetingId", request.meeting_url)
                    
                    print(f"✅ Bot successfully joined meeting")
                    
                    return JoinMeetingResponse(
                        meeting_id=meeting_id,
                        status="joined",
                        message="Bot successfully joined the meeting"
                    )
                else:
                    error_msg = bot_response.get("error", "Unknown error from bot-runner")
                    print(f"❌ Bot failed to join meeting: {error_msg}")
                    raise HTTPException(status_code=500, detail=f"Bot failed to join: {error_msg}")
            else:
                print(f"❌ Bot-runner API error: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Bot-runner API error: {response.status_code}"
                )
        
    except httpx.TimeoutException:
        print("❌ Bot-runner API timeout")
        raise HTTPException(status_code=504, detail="Bot-runner API timeout")
    except httpx.ConnectError:
        print("❌ Bot-runner API connection failed - is headless bot running?")
        raise HTTPException(status_code=503, detail="Bot-runner service unavailable")
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to join meeting: {str(e)}")


# ============================================================================
# MEETING REGISTRATION AND MANAGEMENT
# ============================================================================

class FetchAndRegisterRequest(BaseModel):
    meeting_url: str


class FetchAndRegisterResponse(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    meeting_number: Optional[str]
    host_email: Optional[str]
    is_new: bool
    last_chunk_id: int
    message: str


class UpdateMeetingStatusRequest(BaseModel):
    is_active: bool
    actual_join_time: Optional[str] = None
    actual_leave_time: Optional[str] = None


@router.post("/meetings/fetch-and-register", response_model=FetchAndRegisterResponse)
async def fetch_and_register_meeting(
    request: FetchAndRegisterRequest,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """
    Fetch meeting metadata from Webex APIs and register in database.
    Returns meeting UUID for bot-runner to use.
    
    Workflow:
    1. Call Webex List Meetings API to get meeting details
    2. Call Webex List Participants API to get participant emails
    3. Create or update meeting record in database
    4. Return meeting UUID and last chunk ID
    """
    try:
        print(f"📋 FETCH AND REGISTER - URL: {request.meeting_url[:50]}...")
        
        # Initialize Webex API client with Service App credentials
        from app.services.webex_api import WebexMeetingsAPI
        webex_api = WebexMeetingsAPI(
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            refresh_token=settings.webex_refresh_token
        )
        
        # Fetch complete meeting metadata from Webex APIs
        print(f"🌐 Calling Webex APIs to fetch meeting metadata...")
        metadata = await webex_api.get_full_meeting_metadata(request.meeting_url)
        
        if not metadata or not metadata.get("webex_meeting_id"):
            print(f"❌ Could not fetch meeting details from Webex API")
            raise HTTPException(status_code=404, detail="Meeting not found in Webex")
        
        webex_meeting_id = metadata["webex_meeting_id"]
        print(f"✅ Metadata fetched - webex_meeting_id: {webex_meeting_id}")
        
        # Check if meeting already exists (bot rejoining)
        existing_meeting = db.query(Meeting).filter(
            Meeting.webex_meeting_id == webex_meeting_id
        ).first()
        
        if existing_meeting:
            # Meeting exists - bot is rejoining
            print(f"🔄 Meeting exists - reactivating (UUID: {existing_meeting.id})")
            
            # Update meeting status
            existing_meeting.is_active = True
            existing_meeting.actual_join_time = datetime.utcnow()
            
            # Update participant list
            existing_meeting.participant_emails = metadata.get("participant_emails", [])
            
            db.commit()
            db.refresh(existing_meeting)
            
            # Get last chunk ID for this meeting
            max_chunk_id = db.query(func.max(AudioChunk.chunk_id)).filter(
                AudioChunk.meeting_id == existing_meeting.id
            ).scalar()
            last_chunk_id = max_chunk_id if max_chunk_id is not None else 0
            
            print(f"✅ Meeting reactivated - last_chunk_id: {last_chunk_id}")
            
            return FetchAndRegisterResponse(
                meeting_uuid=str(existing_meeting.id),
                webex_meeting_id=existing_meeting.webex_meeting_id,
                meeting_number=existing_meeting.meeting_number,
                host_email=existing_meeting.host_email,
                is_new=False,
                last_chunk_id=last_chunk_id,
                message="Meeting reactivated - chunk counting will continue"
            )
        
        else:
            # New meeting - create record
            print(f"🆕 New meeting - creating record")
            
            # Parse datetime strings if provided
            scheduled_start = None
            scheduled_end = None
            if metadata.get("scheduled_start_time"):
                scheduled_start = datetime.fromisoformat(metadata["scheduled_start_time"].replace('Z', '+00:00'))
            if metadata.get("scheduled_end_time"):
                scheduled_end = datetime.fromisoformat(metadata["scheduled_end_time"].replace('Z', '+00:00'))
            
            # Create new meeting record
            new_meeting = Meeting(
                webex_meeting_id=metadata["webex_meeting_id"],
                meeting_number=metadata.get("meeting_number"),
                meeting_link=request.meeting_url,
                host_email=metadata.get("host_email"),
                participant_emails=metadata.get("participant_emails", []),
                scheduled_start_time=scheduled_start,
                scheduled_end_time=scheduled_end,
                actual_join_time=datetime.utcnow(),
                is_active=True,
                is_personal_room=metadata.get("is_personal_room", False),
                meeting_type=metadata.get("meeting_type"),
                scheduled_type=metadata.get("scheduled_type")
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            
            print(f"✅ Meeting created - UUID: {new_meeting.id}")
            
            return FetchAndRegisterResponse(
                meeting_uuid=str(new_meeting.id),
                webex_meeting_id=new_meeting.webex_meeting_id,
                meeting_number=new_meeting.meeting_number,
                host_email=new_meeting.host_email,
                is_new=True,
                last_chunk_id=0,
                message="New meeting registered - chunk counting starts from 1"
            )
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ FETCH AND REGISTER FAILED - {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch and register meeting: {str(e)}")


@router.patch("/meetings/{meeting_uuid}/status")
async def update_meeting_status(
    meeting_uuid: str,
    request: UpdateMeetingStatusRequest,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """
    Update meeting active status and join/leave times.
    """
    try:
        # Parse UUID
        try:
            uuid_obj = uuid.UUID(meeting_uuid)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid meeting UUID format")
        
        # Find meeting
        meeting = db.query(Meeting).filter(Meeting.id == uuid_obj).first()
        
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        
        # Update status
        meeting.is_active = request.is_active
        
        # Update timestamps if provided
        if request.actual_join_time:
            meeting.actual_join_time = datetime.fromisoformat(request.actual_join_time.replace('Z', '+00:00'))
        
        if request.actual_leave_time:
            meeting.actual_leave_time = datetime.fromisoformat(request.actual_leave_time.replace('Z', '+00:00'))
        
        db.commit()
        
        status_text = "active" if request.is_active else "inactive"
        print(f"✅ Meeting {meeting_uuid} marked as {status_text}")
        
        return {"status": "updated", "message": f"Meeting marked as {status_text}"}
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ UPDATE STATUS FAILED - {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update meeting status: {str(e)}")
