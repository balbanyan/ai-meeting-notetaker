from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
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
from app.core.auth import verify_bot_token, verify_external_api_key
from app.models.meeting import Meeting
from app.models.audio_chunk import AudioChunk
from app.models.speaker_transcript import SpeakerTranscript
from app.bot_runner import bot_runner_manager
from app.services.llm_processor import process_transcripts_with_llm, generate_meeting_summary

router = APIRouter()


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

async def wait_for_bot_runner_ready(max_wait_seconds: int = 20) -> bool:
    """
    Asynchronously wait for bot-runner to be ready (non-blocking).
    
    Returns True if bot-runner becomes ready within timeout, False otherwise.
    """
    print(f"⏳ Waiting for bot-runner to be ready (max {max_wait_seconds}s)...")
    
    for attempt in range(max_wait_seconds):
        if bot_runner_manager.is_running():
            print(f"✅ Bot-runner is ready (took {attempt + 1}s)")
            return True
        
        # Async sleep to not block the event loop
        await asyncio.sleep(1)
        
        if attempt % 3 == 0 and attempt > 0:
            print(f"⏳ Still waiting for bot-runner... ({attempt}/{max_wait_seconds}s)")
    
    print(f"❌ Bot-runner did not become ready within {max_wait_seconds}s")
    return False

# If needed I can add a workflow that starts with the web link not the meeting ID (Using the "List Meetings By An Admin" API)

# ============================================================================
# PRODUCTION ENDPOINT - Embedded App Workflow
# ============================================================================


class RegisterAndJoinRequest(BaseModel):
    meeting_id: str  # Webex meeting ID from SDK
    enable_multistream: Optional[bool] = None  # Optional: True for multistream, False for legacy, None for default


class RegisterAndJoinResponse(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    status: str
    message: str


@router.post("/meetings/register-and-join", response_model=RegisterAndJoinResponse)
async def register_and_join_meeting(
    request: RegisterAndJoinRequest,
    db: Session = Depends(get_db)
):
    """
    Register meeting from embedded app and trigger bot join.
    
    Main production workflow:
    1. Receive meeting_id from Webex Embedded App frontend
    2. Call get_complete_meeting_data() to retrieve all metadata from Webex APIs:
       - GET /meetings/{meetingId} (admin) → metadata, meeting_number, host_email, times
       - GET /meetings?meetingNumber&hostEmail → webLink (after getting host_email)
       - GET /meeting-invitees → participant list (parallel with webLink)
    3. Create/update meeting record in database
    4. Trigger bot join via bot-runner with API-retrieved webLink + meetingUuid
    5. Return success response
    """
    try:
        print(f"📱 REGISTER AND JOIN - Meeting ID: {request.meeting_id}")
        
        # Initialize Webex API client
        from app.services.webex_api import WebexMeetingsAPI
        webex_api = WebexMeetingsAPI(
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            refresh_token=settings.webex_refresh_token,
            personal_token=settings.webex_personal_access_token
        )
        
        # Get complete meeting data from Webex APIs
        print(f"🌐 Fetching complete meeting data from Webex APIs...")
        meeting_data = await webex_api.get_complete_meeting_data(request.meeting_id)
        
        # Extract data from API response
        meeting_link = meeting_data["meeting_link"]
        meeting_number = meeting_data["meeting_number"]
        meeting_title = meeting_data.get("title")
        host_email = meeting_data["host_email"]
        participant_emails = meeting_data.get("participant_emails", [])
        cohost_emails = meeting_data.get("cohost_emails", [])
        
        # Parse datetime strings
        scheduled_start = None
        scheduled_end = None
        try:
            if meeting_data.get("scheduled_start_time"):
                scheduled_start = datetime.fromisoformat(meeting_data["scheduled_start_time"].replace('Z', '+00:00'))
        except (ValueError, AttributeError) as e:
            print(f"⚠️ Could not parse start_time: {e}")
        
        try:
            if meeting_data.get("scheduled_end_time"):
                scheduled_end = datetime.fromisoformat(meeting_data["scheduled_end_time"].replace('Z', '+00:00'))
        except (ValueError, AttributeError) as e:
            print(f"⚠️ Could not parse end_time: {e}")
        
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
            existing_meeting.cohost_emails = cohost_emails
            existing_meeting.host_email = host_email
            existing_meeting.meeting_link = meeting_link
            existing_meeting.meeting_number = meeting_number
            existing_meeting.meeting_title = meeting_title
            
            # Update scheduled times if provided
            if scheduled_start:
                existing_meeting.scheduled_start_time = scheduled_start
            if scheduled_end:
                existing_meeting.scheduled_end_time = scheduled_end
            
            # Update meeting type if provided
            if meeting_data.get("meeting_type"):
                existing_meeting.meeting_type = meeting_data["meeting_type"]
            
            db.commit()
            db.refresh(existing_meeting)
            
            meeting_uuid = str(existing_meeting.id)
        else:
            # Create new meeting record
            print(f"🆕 Creating new meeting record")
            
            new_meeting = Meeting(
                webex_meeting_id=request.meeting_id,
                meeting_number=meeting_number,
                meeting_link=meeting_link,
                meeting_title=meeting_title,
                host_email=host_email,
                participant_emails=participant_emails,
                cohost_emails=cohost_emails,
                scheduled_start_time=scheduled_start,
                scheduled_end_time=scheduled_end,
                actual_join_time=datetime.utcnow(),
                is_active=True,
                meeting_type=meeting_data.get("meeting_type", "meeting")
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            
            meeting_uuid = str(new_meeting.id)
            print(f"✅ Meeting created - UUID: {meeting_uuid}")
        
        # Trigger bot join via bot-runner
        print(f"🤖 Triggering bot join with API-retrieved webLink...")
        
        # Ensure bot-runner subprocess is running (start on-demand if needed)
        if not bot_runner_manager.is_running():
            print("🔄 Bot-runner not running, starting now...")
            if not bot_runner_manager.start():
                raise HTTPException(
                    status_code=503, 
                    detail="Bot-runner service failed to start"
                )
        
        # Wait for bot-runner to be ready (async, non-blocking)
        if not await wait_for_bot_runner_ready(max_wait_seconds=20):
            raise HTTPException(
                status_code=503,
                detail="Bot-runner service failed to become ready in time"
            )
        
        bot_runner_url = f"{settings.bot_runner_url}/join"
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                payload = {
                    "meetingUrl": meeting_link,  # Use API-retrieved webLink
                    "meetingUuid": meeting_uuid,  # Pass meeting UUID from database
                    "hostEmail": host_email  # Pass host email from API
                }
                
                # Add enableMultistream if specified
                if request.enable_multistream is not None:
                    payload["enableMultistream"] = request.enable_multistream
                
                bot_response = await client.post(
                    bot_runner_url,
                    json=payload,
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
        print(f"❌ REGISTER AND JOIN FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to register meeting: {str(e)}")


# ============================================================================
# TESTING ENDPOINT - Bot Runner Testing
# ============================================================================

class TestJoinRequest(BaseModel):
    meeting_url: str
    enable_multistream: Optional[bool] = None  # Optional: True for multistream, False for legacy, None for default


class TestJoinResponse(BaseModel):
    meeting_uuid: str
    meeting_url: str
    status: str
    message: str


class UpdateMeetingStatusRequest(BaseModel):
    is_active: bool
    actual_join_time: Optional[str] = None
    actual_leave_time: Optional[str] = None


@router.post("/meetings/test-join", response_model=TestJoinResponse)
async def test_join_meeting(
    request: TestJoinRequest,
    db: Session = Depends(get_db)
):
    """
    Test endpoint to trigger bot-runner without Webex API calls.
    
    This endpoint:
    - Creates a minimal meeting record in DB (for chunk/speaker references)
    - Triggers bot-runner directly with meeting URL
    - Does NOT call Webex APIs (no metadata fetching)
    - Still processes audio chunks and speaker events normally
    
    Perfect for testing bot-runner without valid Webex credentials.
    """
    try:
        print(f"🧪 TEST JOIN - Creating minimal meeting record for testing")
        
        # Create minimal meeting record without Webex API calls
        # Use meeting URL hash as a simple webex_meeting_id substitute
        test_meeting_id = f"test_{hash(request.meeting_url) % 1000000}"
        
        # Check if this test meeting already exists
        existing_meeting = db.query(Meeting).filter(
            Meeting.webex_meeting_id == test_meeting_id
        ).first()
        
        if existing_meeting:
            print(f"🔄 Test meeting exists - reactivating (UUID: {existing_meeting.id})")
            existing_meeting.is_active = True
            existing_meeting.actual_join_time = datetime.utcnow()
            db.commit()
            db.refresh(existing_meeting)
            meeting_uuid = str(existing_meeting.id)
        else:
            # Create new minimal meeting record
            print(f"🆕 Creating minimal test meeting record")
            new_meeting = Meeting(
                webex_meeting_id=test_meeting_id,
                meeting_link=request.meeting_url,
                meeting_number="TEST",
                host_email="test@example.com",
                participant_emails=[],
                cohost_emails=[],
                actual_join_time=datetime.utcnow(),
                is_active=True,
                meeting_type="test"
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            meeting_uuid = str(new_meeting.id)
            print(f"✅ Test meeting created - UUID: {meeting_uuid}")
        
        # Trigger bot-runner
        print(f"🤖 Triggering bot-runner for testing...")
        
        # Ensure bot-runner subprocess is running (start on-demand if needed)
        if not bot_runner_manager.is_running():
            print("🔄 Bot-runner not running, starting now...")
            if not bot_runner_manager.start():
                raise HTTPException(
                    status_code=503,
                    detail="Bot-runner service failed to start"
                )
        
        # Wait for bot-runner to be ready (async, non-blocking)
        if not await wait_for_bot_runner_ready(max_wait_seconds=20):
            raise HTTPException(
                status_code=503,
                detail="Bot-runner service failed to become ready in time"
            )
        
        bot_runner_url = f"{settings.bot_runner_url}/join"
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                payload = {
                    "meetingUrl": request.meeting_url,
                    "meetingUuid": meeting_uuid,  # Pass UUID so chunks/speakers work
                    "hostEmail": "test@example.com"
                }
                
                # Add enableMultistream if specified
                if request.enable_multistream is not None:
                    payload["enableMultistream"] = request.enable_multistream
                
                bot_response = await client.post(
                    bot_runner_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                
                if bot_response.status_code == 200:
                    bot_data = bot_response.json()
                    
                    if bot_data.get("success"):
                        print(f"✅ Bot successfully triggered for testing")
                        
                        return TestJoinResponse(
                            meeting_uuid=meeting_uuid,
                            meeting_url=request.meeting_url,
                            status="success",
                            message="Test meeting created and bot join triggered (no Webex API calls)"
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
        print(f"❌ TEST JOIN FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to create test meeting: {str(e)}")


@router.patch("/meetings/{meeting_uuid}/status")
async def update_meeting_status(
    meeting_uuid: str,
    request: UpdateMeetingStatusRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """
    Update meeting active status and join/leave times.
    When is_active becomes False, triggers background task to generate meeting summary.
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
        
        # Trigger meeting summary generation when bot leaves (is_active becomes False)
        if not request.is_active:
            print(f"🤖 Triggering background task to generate meeting summary for {meeting_uuid}")
            # Create a new DB session for the background task
            from app.core.database import SessionLocal
            bg_db = SessionLocal()
            background_tasks.add_task(generate_meeting_summary, uuid_obj, bg_db)
        
        return {"status": "updated", "message": f"Meeting marked as {status_text}"}
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ UPDATE STATUS FAILED - {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update meeting status: {str(e)}")


# ============================================================================
# EXTERNAL API ENDPOINT - Process Transcripts with LLM
# ============================================================================


class ProcessTranscriptsRequest(BaseModel):
    meeting_link: str
    system_prompt: str
    model: str = "openai/gpt-oss-120b"
    meeting_id: Optional[str] = None  # Optional: Webex meeting ID for exact meeting


class ProcessTranscriptsResponse(BaseModel):
    llm_response: str
    unique_speakers: List[str]
    meeting_uuid: str  # Internal database UUID
    meeting_id: str  # Webex meeting ID
    transcript_count: int


@router.post("/meetings/process-transcripts", response_model=ProcessTranscriptsResponse)
async def process_transcripts(
    request: ProcessTranscriptsRequest,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_external_api_key)
):
    """
    Process meeting transcripts with an LLM for external applications.
    
    This endpoint:
    1. Retrieves the meeting by meeting_id (if provided) or latest meeting_link
    2. Fetches all speaker_transcripts for that meeting (ordered chronologically)
    3. Processes transcripts with specified LLM and system prompt
    4. Returns LLM response and unique speaker names
    
    Authentication: Requires X-API-Key header with valid external API key.
    
    Note: Can be called mid-meeting to get all transcripts available so far.
    """
    try:
        print(f"🔍 PROCESS TRANSCRIPTS: meetings/process-transcripts")
        
        # Query meeting based on meeting_id (Webex) or meeting_link
        if request.meeting_id:
            print(f"📌 Using provided Webex meeting_id")
            meeting = db.query(Meeting).filter(
                Meeting.webex_meeting_id == request.meeting_id
            ).first()
        else:
            print(f"🔗 Querying latest meeting by meeting_link")
            # Get the latest meeting for this meeting_link (ordered by created_at DESC)
            meeting = db.query(Meeting).filter(
                Meeting.meeting_link == request.meeting_link
            ).order_by(Meeting.created_at.desc()).first()
        
        if not meeting:
            raise HTTPException(
                status_code=404,
                detail="Meeting not found for the provided meeting_link or meeting_id"
            )
        
        print(f"✅ Meeting found - UUID: {meeting.id}")
        
        # Fetch all speaker transcripts for this meeting, ordered chronologically
        transcripts = db.query(SpeakerTranscript).filter(
            SpeakerTranscript.meeting_id == meeting.id
        ).order_by(SpeakerTranscript.start_time.asc()).all()
        
        if not transcripts:
            raise HTTPException(
                status_code=404,
                detail="No transcripts found for this meeting"
            )
        
        print(f"📝 Found {len(transcripts)} transcript(s)")
        
        # Extract unique speaker names (filter out None values)
        unique_speakers = list(set(
            t.speaker_name for t in transcripts if t.speaker_name
        ))
        unique_speakers.sort()  # Sort alphabetically for consistency
        
        print(f"👥 Extracted unique speakers")
        
        # Process transcripts with LLM
        print(f"🤖 Processing with LLM model: {request.model}")
        llm_response = process_transcripts_with_llm(
            transcripts=transcripts,
            system_prompt=request.system_prompt,
            model=request.model
        )
        
        print(f"✅ LLM processing complete")
        
        return ProcessTranscriptsResponse(
            llm_response=llm_response,
            unique_speakers=unique_speakers,
            meeting_uuid=str(meeting.id),
            meeting_id=meeting.webex_meeting_id,
            transcript_count=len(transcripts)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ PROCESS TRANSCRIPTS FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process transcripts: {str(e)}"
        )


# ============================================================================
# EXTERNAL API ENDPOINT - Get Raw Transcripts
# ============================================================================


class TranscriptItem(BaseModel):
    speaker_name: str
    transcript_text: str
    start_time: datetime
    end_time: datetime


class GetTranscriptsRequest(BaseModel):
    meeting_link: str
    meeting_id: Optional[str] = None  # Optional: Webex meeting ID for exact meeting


class GetTranscriptsResponse(BaseModel):
    transcripts: List[TranscriptItem]
    unique_speakers: List[str]
    meeting_uuid: str  # Internal database UUID
    meeting_id: str  # Webex meeting ID
    transcript_count: int


@router.post("/meetings/get-transcripts", response_model=GetTranscriptsResponse)
async def get_transcripts(
    request: GetTranscriptsRequest,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_external_api_key)
):
    """
    Retrieve raw meeting transcripts for external applications.
    
    This endpoint:
    1. Retrieves the meeting by meeting_id (if provided) or latest meeting_link
    2. Fetches all speaker_transcripts for that meeting (ordered chronologically)
    3. Returns transcript array with speaker names, text, and timestamps
    
    Authentication: Requires API-Key header with valid external API key.
    
    Note: Can be called mid-meeting to get all transcripts available so far.
    """
    try:
        print(f"🔍 GET TRANSCRIPTS: meetings/get-transcripts")
        
        # Query meeting based on meeting_id (Webex) or meeting_link
        if request.meeting_id:
            print(f"📌 Using provided Webex meeting_id")
            meeting = db.query(Meeting).filter(
                Meeting.webex_meeting_id == request.meeting_id
            ).first()
        else:
            print(f"🔗 Querying latest meeting by meeting_link")
            # Get the latest meeting for this meeting_link (ordered by created_at DESC)
            meeting = db.query(Meeting).filter(
                Meeting.meeting_link == request.meeting_link
            ).order_by(Meeting.created_at.desc()).first()
        
        if not meeting:
            raise HTTPException(
                status_code=404,
                detail="Meeting not found for the provided meeting_link or meeting_id"
            )
        
        print(f"✅ Meeting found - UUID: {meeting.id}")
        
        # Fetch all speaker transcripts for this meeting, ordered chronologically
        transcripts = db.query(SpeakerTranscript).filter(
            SpeakerTranscript.meeting_id == meeting.id
        ).order_by(SpeakerTranscript.start_time.asc()).all()
        
        if not transcripts:
            raise HTTPException(
                status_code=404,
                detail="No transcripts found for this meeting"
            )
        
        print(f"📝 Found {len(transcripts)} transcript(s)")
        
        # Build transcript items array
        transcript_items = []
        for transcript in transcripts:
            item = TranscriptItem(
                speaker_name=transcript.speaker_name or "Unknown Speaker",
                transcript_text=transcript.transcript_text,
                start_time=transcript.start_time,
                end_time=transcript.end_time
            )
            transcript_items.append(item)
        
        # Extract unique speaker names (filter out None values)
        unique_speakers = list(set(
            t.speaker_name for t in transcripts if t.speaker_name
        ))
        unique_speakers.sort()  # Sort alphabetically for consistency
        
        print(f"👥 Extracted unique speakers")
        print(f"✅ Transcripts retrieved successfully")
        
        return GetTranscriptsResponse(
            transcripts=transcript_items,
            unique_speakers=unique_speakers,
            meeting_uuid=str(meeting.id),
            meeting_id=meeting.webex_meeting_id,
            transcript_count=len(transcripts)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ GET TRANSCRIPTS FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve transcripts: {str(e)}"
        )


# ============================================================================
# FRONTEND API ENDPOINTS - Meeting List & Details
# ============================================================================


class MeetingListItem(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    meeting_number: Optional[str]
    meeting_title: Optional[str]
    host_email: Optional[str]
    participant_emails: Optional[List[str]]
    cohost_emails: Optional[List[str]]
    scheduled_start_time: Optional[datetime]
    scheduled_end_time: Optional[datetime]
    actual_join_time: Optional[datetime]
    actual_leave_time: Optional[datetime]
    meeting_summary: Optional[str]
    
    class Config:
        from_attributes = True


class MeetingsListResponse(BaseModel):
    meetings: List[MeetingListItem]
    total_count: int


@router.get("/meetings/list", response_model=MeetingsListResponse)
async def list_meetings(db: Session = Depends(get_db)):
    """
    Get all completed meetings (is_active = false) for the frontend dashboard.
    
    Returns meetings ordered by most recent first (actual_leave_time DESC).
    No authentication required - matches embedded app pattern.
    """
    try:
        print(f"📋 LIST MEETINGS: fetching all inactive meetings")
        
        # Query all meetings where is_active = False
        meetings = db.query(Meeting).filter(
            Meeting.is_active == False
        ).order_by(Meeting.actual_leave_time.desc()).all()
        
        print(f"✅ Found {len(meetings)} completed meeting(s)")
        
        # Build response items
        meeting_items = []
        for meeting in meetings:
            item = MeetingListItem(
                meeting_uuid=str(meeting.id),
                webex_meeting_id=meeting.webex_meeting_id,
                meeting_number=meeting.meeting_number,
                meeting_title=meeting.meeting_title,
                host_email=meeting.host_email,
                participant_emails=meeting.participant_emails or [],
                cohost_emails=meeting.cohost_emails or [],
                scheduled_start_time=meeting.scheduled_start_time,
                scheduled_end_time=meeting.scheduled_end_time,
                actual_join_time=meeting.actual_join_time,
                actual_leave_time=meeting.actual_leave_time,
                meeting_summary=meeting.meeting_summary
            )
            meeting_items.append(item)
        
        return MeetingsListResponse(
            meetings=meeting_items,
            total_count=len(meetings)
        )
    
    except Exception as e:
        print(f"❌ LIST MEETINGS FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve meetings list: {str(e)}"
        )


class MeetingDetailsTranscript(BaseModel):
    speaker_name: Optional[str]
    transcript_text: str
    start_time: datetime
    end_time: datetime
    
    class Config:
        from_attributes = True


class MeetingDetailsResponse(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    meeting_number: Optional[str]
    meeting_title: Optional[str]
    meeting_link: str
    host_email: Optional[str]
    participant_emails: Optional[List[str]]
    cohost_emails: Optional[List[str]]
    scheduled_start_time: Optional[datetime]
    scheduled_end_time: Optional[datetime]
    actual_join_time: Optional[datetime]
    actual_leave_time: Optional[datetime]
    meeting_type: Optional[str]
    meeting_summary: Optional[str]
    transcripts: List[MeetingDetailsTranscript]
    
    class Config:
        from_attributes = True


@router.get("/meetings/{meeting_uuid}", response_model=MeetingDetailsResponse)
async def get_meeting_details(meeting_uuid: str, db: Session = Depends(get_db)):
    """
    Get detailed meeting information including transcripts for a specific meeting.
    
    Returns full meeting data plus all speaker transcripts ordered chronologically.
    No authentication required - matches embedded app pattern.
    """
    try:
        print(f"🔍 GET MEETING DETAILS: {meeting_uuid}")
        
        # Parse UUID
        try:
            uuid_obj = uuid.UUID(meeting_uuid)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid meeting UUID format")
        
        # Find meeting
        meeting = db.query(Meeting).filter(Meeting.id == uuid_obj).first()
        
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        
        print(f"✅ Meeting found - {meeting.webex_meeting_id}")
        
        # Fetch all speaker transcripts for this meeting, ordered chronologically
        transcripts = db.query(SpeakerTranscript).filter(
            SpeakerTranscript.meeting_id == uuid_obj
        ).order_by(SpeakerTranscript.start_time.asc()).all()
        
        print(f"📝 Found {len(transcripts)} transcript(s)")
        
        # Build transcript items
        transcript_items = [
            MeetingDetailsTranscript(
                speaker_name=t.speaker_name,
                transcript_text=t.transcript_text,
                start_time=t.start_time,
                end_time=t.end_time
            )
            for t in transcripts
        ]
        
        return MeetingDetailsResponse(
            meeting_uuid=str(meeting.id),
            webex_meeting_id=meeting.webex_meeting_id,
            meeting_number=meeting.meeting_number,
            meeting_title=meeting.meeting_title,
            meeting_link=meeting.meeting_link,
            host_email=meeting.host_email,
            participant_emails=meeting.participant_emails or [],
            cohost_emails=meeting.cohost_emails or [],
            scheduled_start_time=meeting.scheduled_start_time,
            scheduled_end_time=meeting.scheduled_end_time,
            actual_join_time=meeting.actual_join_time,
            actual_leave_time=meeting.actual_leave_time,
            meeting_type=meeting.meeting_type,
            meeting_summary=meeting.meeting_summary,
            transcripts=transcript_items
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ GET MEETING DETAILS FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve meeting details: {str(e)}"
        )
