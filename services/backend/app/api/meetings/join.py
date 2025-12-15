from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from datetime import datetime
import httpx
import asyncio
from app.core.config import settings
from app.core.database import get_db
from app.models.meeting import Meeting
from app.bot_runner import bot_runner_manager
from .schemas import (
    RegisterAndJoinRequest,
    RegisterAndJoinWithLinkRequest,
    RegisterAndJoinResponse,
    RegisterAndJoinByLinkResponse,
)

router = APIRouter()

# Semaphore to limit concurrent bot joins (prevents overwhelming bot-runner)
bot_join_semaphore = asyncio.Semaphore(20)


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


# ============================================================================
# PRODUCTION ENDPOINT - Embedded App Workflow
# ============================================================================


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
        print(f"📱 REGISTER AND JOIN")
        
        # Fetch complete meeting data from Webex first (need scheduled_type for logic)
        from app.services.webex_api import WebexMeetingsAPI
        webex_api = WebexMeetingsAPI(
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            refresh_token=settings.webex_refresh_token,
            personal_token=settings.webex_personal_access_token
        )
        
        try:
            meeting_data = await webex_api.get_complete_meeting_data(request.meeting_id)
        finally:
            await webex_api.close()  # Close HTTP client to release connections
        
        # Extract data from API response
        meeting_link = meeting_data["meeting_link"]
        meeting_number = meeting_data["meeting_number"]
        meeting_title = meeting_data.get("title")
        host_email = meeting_data["host_email"]
        participant_emails = meeting_data.get("participant_emails", [])
        cohost_emails = meeting_data.get("cohost_emails", [])
        scheduled_type = meeting_data.get("scheduled_type")  # "meeting", "webinar", "personalRoomMeeting"
        
        # Save original Webex ID for WebSocket broadcasts (before any modification)
        original_webex_id = request.meeting_id
        
        # For personal room meetings, append timestamp to create unique session ID
        is_personal_room = scheduled_type == "personalRoomMeeting"
        if is_personal_room:
            stored_webex_id = f"{request.meeting_id}_{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"
            print(f"🏠 Personal room detected - creating unique session ID: {stored_webex_id}")
            
            # Check for active bot in this personal room by meeting_link
            active_session = db.query(Meeting).filter(
                Meeting.meeting_link == meeting_link,
                Meeting.is_active == True
            ).first()
            
            if active_session:
                meeting_uuid = str(active_session.id)
                print(f"⚠️ Bot is already active in this personal room (Meeting UUID: {meeting_uuid})")
                raise HTTPException(
                    status_code=409,
                    detail=f"Bot is already active in this personal room (Meeting UUID: {meeting_uuid})"
                )
        else:
            stored_webex_id = request.meeting_id
            
            # Check if meeting already exists for non-personal rooms
            existing_meeting = db.query(Meeting).filter(
                Meeting.webex_meeting_id == request.meeting_id
            ).first()
            
            if existing_meeting and existing_meeting.is_active:
                meeting_uuid = str(existing_meeting.id)
                print(f"⚠️ Bot is already active in this meeting (Meeting UUID: {meeting_uuid})")
                raise HTTPException(
                    status_code=409,
                    detail=f"Bot is already active in this meeting (Meeting UUID: {meeting_uuid})"
                )
        
        # For non-personal rooms, check if meeting exists (for update logic)
        existing_meeting = None if is_personal_room else db.query(Meeting).filter(
            Meeting.webex_meeting_id == request.meeting_id
        ).first()
        
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
        
        # Update existing meeting or create new one
        # Note: For personal rooms, we always create new. For others, update if exists.
        if existing_meeting and not is_personal_room:
            # Update existing meeting (we already know it's not active)
            print(f"🔄 Meeting exists - updating (UUID: {existing_meeting.id})")
            
            existing_meeting.is_active = True
            # Only set actual_join_time on first join, not on rejoins
            if not existing_meeting.actual_join_time:
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
            
            # Use scheduled_type for meeting_type (more accurate than meetingType)
            if scheduled_type:
                existing_meeting.meeting_type = scheduled_type
            
            # Non-voting and screenshot settings (API parameters override .env if provided)
            existing_meeting.screenshots_enabled = settings.enable_screenshots
            existing_meeting.non_voting_enabled = request.enable_non_voting if request.enable_non_voting is not None else settings.enable_non_voting
            existing_meeting.non_voting_call_frequency = request.non_voting_call_frequency if request.non_voting_call_frequency is not None else settings.non_voting_call_frequency
            
            db.commit()
            db.refresh(existing_meeting)
            
            meeting_uuid = str(existing_meeting.id)
            
            # Broadcast status update via WebSocket to both IDs
            # (HomePage uses UUID, EmbeddedApp uses original Webex meeting ID)
            from app.api.websocket import manager
            await manager.broadcast_status(original_webex_id, True)  # Original Webex meeting ID
            await manager.broadcast_status(meeting_uuid, True)  # UUID
            print(f"📡 Broadcasted bot active status to WebSocket subscribers (Webex ID + UUID)")
        else:
            # Create new meeting record (always for personal rooms, or if not exists)
            print(f"🆕 Creating new meeting record" + (" (personal room session)" if is_personal_room else ""))
            
            new_meeting = Meeting(
                webex_meeting_id=stored_webex_id,  # Timestamped for personal rooms
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
                meeting_type=scheduled_type or "meeting",  # Use scheduled_type (more accurate)
                # Non-voting and screenshot settings (API parameters override .env if provided)
                screenshots_enabled=settings.enable_screenshots,
                non_voting_enabled=request.enable_non_voting if request.enable_non_voting is not None else settings.enable_non_voting,
                non_voting_call_frequency=request.non_voting_call_frequency if request.non_voting_call_frequency is not None else settings.non_voting_call_frequency
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            
            meeting_uuid = str(new_meeting.id)
            print(f"✅ Meeting created - UUID: {meeting_uuid}")
            
            # Broadcast status update via WebSocket to both IDs
            # (HomePage uses UUID, EmbeddedApp uses original Webex meeting ID)
            from app.api.websocket import manager
            await manager.broadcast_status(original_webex_id, True)  # Original Webex meeting ID
            await manager.broadcast_status(meeting_uuid, True)  # UUID
            print(f"📡 Broadcasted bot active status to WebSocket subscribers (Webex ID + UUID)")
        
        # Trigger bot join via bot-runner (semaphore limits concurrent joins to 20)
        async with bot_join_semaphore:
            print(f"🤖 Triggering bot join with API-retrieved webLink (Meeting UUID: {meeting_uuid})...")
            
            # Ensure bot-runner subprocess is running (start on-demand if needed)
            if not bot_runner_manager.is_running():
                print(f"🔄 Bot-runner not running, starting now (Meeting UUID: {meeting_uuid})...")
                if not bot_runner_manager.start():
                    raise HTTPException(
                        status_code=503, 
                        detail="Bot-runner service failed to start"
                    )
            else:
                print(f"✅ Bot-runner already running (Meeting UUID: {meeting_uuid})")
            
            # Wait for bot-runner to be ready (async, non-blocking)
            if not await wait_for_bot_runner_ready(max_wait_seconds=20):
                raise HTTPException(
                    status_code=503,
                    detail="Bot-runner service failed to become ready in time"
                )
            
            bot_runner_url = f"{settings.bot_runner_url}/join"
            
            try:
                async with httpx.AsyncClient(timeout=150.0) as client:  # Increased to 150s (bot-runner has 120s timeout + buffer)
                    payload = {
                        "meetingUrl": meeting_link,  # Use API-retrieved webLink
                        "meetingUuid": meeting_uuid,  # Pass meeting UUID from database
                        "hostEmail": host_email,  # Pass host email from API
                        "maxDurationMinutes": settings.bot_max_duration_minutes  # Bot timeout duration
                    }
                    
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
                                webex_meeting_id=original_webex_id,  # Return original ID (not timestamped)
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


@router.post("/meetings/register-and-join-with-link", response_model=RegisterAndJoinByLinkResponse)
async def register_and_join_meeting_with_link(
    request: RegisterAndJoinWithLinkRequest,
    db: Session = Depends(get_db)
):
    """
    Register meeting from link only and trigger bot join.
    
    Standalone workflow (no embedded app):
    1. Receive meeting_link only
    2. Call List Meetings by Admin API
    3. Find meeting by matching webLink
    4. Use existing get_complete_meeting_data(meeting_id) which calls:
       - GET /meetings/{meetingId} (admin API)
       - GET /meetings?meetingNumber&hostEmail
       - GET /meeting-invitees (for participants/cohosts)
    5. Create/update meeting record in database
    6. Trigger bot join via bot-runner
    7. Return success response
    
    Note: Screenshots always disabled for this endpoint
    """
    try:
        print(f"🔗 REGISTER AND JOIN WITH LINK")
        print(f"   Link Length: {len(request.meeting_link)}")
        
        # Initialize Webex API client
        from app.services.webex_api import WebexMeetingsAPI
        webex_api = WebexMeetingsAPI(
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            refresh_token=settings.webex_refresh_token,
            personal_token=settings.webex_personal_access_token
        )
        
        try:
            # Step 1: Find meeting_id from link first (lightweight check)
            webex_meeting_id = await webex_api.find_meeting_id_by_link(request.meeting_link)
            
            if not webex_meeting_id:
                raise HTTPException(
                    status_code=404,
                    detail="No meeting found with the provided link"
                )
            
            # Fetch complete meeting data
            meeting_data = await webex_api.get_complete_meeting_data(webex_meeting_id)
        finally:
            await webex_api.close()  # Close HTTP client to release connections
        
        # Extract data from API response (same as register_and_join_meeting)
        meeting_link = meeting_data["meeting_link"]
        meeting_number = meeting_data["meeting_number"]
        meeting_title = meeting_data.get("title")
        host_email = meeting_data["host_email"]
        participant_emails = meeting_data.get("participant_emails", [])
        cohost_emails = meeting_data.get("cohost_emails", [])
        scheduled_type = meeting_data.get("scheduled_type")  # "meeting", "webinar", "personalRoomMeeting"
        
        # Save original Webex ID for WebSocket broadcasts (before any modification)
        original_webex_id = webex_meeting_id
        
        # For personal room meetings, append timestamp to create unique session ID
        is_personal_room = scheduled_type == "personalRoomMeeting"
        if is_personal_room:
            stored_webex_id = f"{webex_meeting_id}_{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"
            print(f"🏠 Personal room detected - creating unique session ID")
            
            # Check for active bot in this personal room by meeting_link
            active_session = db.query(Meeting).filter(
                Meeting.meeting_link == meeting_link,
                Meeting.is_active == True
            ).first()
            
            if active_session:
                meeting_uuid = str(active_session.id)
                print(f"⚠️ Bot is already active in this personal room (Meeting UUID: {meeting_uuid})")
                raise HTTPException(
                    status_code=409,
                    detail=f"Bot is already active in this personal room (Meeting UUID: {meeting_uuid})"
                )
        else:
            stored_webex_id = webex_meeting_id
            
            # Check if meeting already exists for non-personal rooms
            existing_meeting = db.query(Meeting).filter(
                Meeting.webex_meeting_id == webex_meeting_id
            ).first()
            
            if existing_meeting and existing_meeting.is_active:
                meeting_uuid = str(existing_meeting.id)
                print(f"⚠️ Bot is already active in this meeting (Meeting UUID: {meeting_uuid})")
                raise HTTPException(
                    status_code=409,
                    detail=f"Bot is already active in this meeting (Meeting UUID: {meeting_uuid})"
                )
        
        # For non-personal rooms, check if meeting exists (for update logic)
        existing_meeting = None if is_personal_room else db.query(Meeting).filter(
            Meeting.webex_meeting_id == webex_meeting_id
        ).first()
        
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
        
        # Update existing meeting or create new one
        # Note: For personal rooms, we always create new. For others, update if exists.
        if existing_meeting and not is_personal_room:
            # Update existing meeting (we already know it's not active)
            meeting_uuid = str(existing_meeting.id)
            print(f"📝 Meeting exists - updating record (Meeting UUID: {meeting_uuid})")
            existing_meeting.meeting_link = meeting_link
            existing_meeting.meeting_title = meeting_title
            existing_meeting.host_email = host_email
            existing_meeting.participant_emails = participant_emails
            existing_meeting.cohost_emails = cohost_emails
            existing_meeting.scheduled_start_time = scheduled_start
            existing_meeting.scheduled_end_time = scheduled_end
            existing_meeting.meeting_type = scheduled_type  # Use scheduled_type (more accurate)
            existing_meeting.screenshots_enabled = settings.enable_screenshots  # Use .env setting
            # API parameters override .env if provided, otherwise use .env
            existing_meeting.non_voting_enabled = request.enable_non_voting if request.enable_non_voting is not None else settings.enable_non_voting
            existing_meeting.non_voting_call_frequency = request.non_voting_call_frequency if request.non_voting_call_frequency is not None else settings.non_voting_call_frequency
            existing_meeting.is_active = True
            # Only set actual_join_time on first join, not on rejoins
            if not existing_meeting.actual_join_time:
                existing_meeting.actual_join_time = datetime.utcnow()
            
            db.commit()
            db.refresh(existing_meeting)
        else:
            # Create new meeting (always for personal rooms, or if not exists)
            print(f"✨ Creating new meeting record" + (" (personal room session)" if is_personal_room else ""))
            new_meeting = Meeting(
                webex_meeting_id=stored_webex_id,  # Timestamped for personal rooms
                meeting_number=meeting_number,
                meeting_link=meeting_link,
                meeting_title=meeting_title,
                host_email=host_email,
                participant_emails=participant_emails,
                cohost_emails=cohost_emails,
                scheduled_start_time=scheduled_start,
                scheduled_end_time=scheduled_end,
                meeting_type=scheduled_type or "meeting",  # Use scheduled_type (more accurate)
                screenshots_enabled=settings.enable_screenshots,  # Use .env setting
                # API parameters override .env if provided, otherwise use .env
                non_voting_enabled=request.enable_non_voting if request.enable_non_voting is not None else settings.enable_non_voting,
                non_voting_call_frequency=request.non_voting_call_frequency if request.non_voting_call_frequency is not None else settings.non_voting_call_frequency,
                is_active=True,
                actual_join_time=datetime.utcnow()
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            
            meeting_uuid = str(new_meeting.id)
            print(f"✨ New meeting created (Meeting UUID: {meeting_uuid})")
        
        print(f"✅ Meeting registered (Meeting UUID: {meeting_uuid})")
        
        # Trigger bot join (semaphore limits concurrent joins to 20)
        async with bot_join_semaphore:
            print(f"🤖 Triggering bot join (Meeting UUID: {meeting_uuid})...")
            
            # Ensure bot-runner subprocess is running
            if not bot_runner_manager.is_running():
                print(f"🔄 Bot-runner not running, starting now (Meeting UUID: {meeting_uuid})...")
                if not bot_runner_manager.start():
                    raise HTTPException(
                        status_code=503, 
                        detail="Bot-runner service failed to start"
                    )
            else:
                print(f"✅ Bot-runner already running (Meeting UUID: {meeting_uuid})")
            
            # Wait for bot-runner to be ready
            if not await wait_for_bot_runner_ready(max_wait_seconds=20):
                raise HTTPException(
                    status_code=503,
                    detail="Bot-runner service failed to become ready in time"
                )
            
            bot_runner_url = f"{settings.bot_runner_url}/join"
            
            try:
                async with httpx.AsyncClient(timeout=150.0) as client:  # Increased to 150s (bot-runner has 120s timeout + buffer)
                    bot_payload = {
                        "meetingUrl": meeting_link,
                        "meetingUuid": meeting_uuid,
                        "hostEmail": host_email,
                        "maxDurationMinutes": settings.bot_max_duration_minutes  # Bot timeout duration
                    }
                    
                    bot_response = await client.post(
                        bot_runner_url,
                        json=bot_payload,
                        headers={"Content-Type": "application/json"}
                    )
                    
                    if bot_response.status_code == 200:
                        bot_data = bot_response.json()
                        
                        if bot_data.get("success"):
                            print(f"✅ Bot successfully triggered to join (Meeting UUID: {meeting_uuid})")
                            
                            return RegisterAndJoinByLinkResponse(
                                meeting_uuid=meeting_uuid,
                                status="Bot triggered successfully"
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
        print(f"❌ REGISTER AND JOIN WITH LINK FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to register meeting with link: {str(e)}")

