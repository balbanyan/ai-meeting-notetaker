from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from datetime import datetime
import uuid
import httpx
import asyncio
from app.core.config import settings
from app.core.database import get_db
from app.core.auth import verify_bot_token
from app.models.meeting import Meeting
from app.bot_runner import bot_runner_manager
from app.services.llm_processor import generate_meeting_summary
from .schemas import (
    TestJoinRequest,
    TestJoinResponse,
    UpdateMeetingStatusRequest,
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
# TESTING ENDPOINT - Bot Runner Testing
# ============================================================================


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
            # NOTE: Multiple bot restriction removed for testing
            # if existing_meeting.is_active:
            #     meeting_uuid = str(existing_meeting.id)
            #     print(f"⚠️ Bot is already active in this test meeting (Meeting UUID: {meeting_uuid})")
            #     raise HTTPException(
            #         status_code=409,
            #         detail=f"Bot is already active in this meeting (Meeting UUID: {meeting_uuid})"
            #     )
            
            print(f"🔄 Test meeting exists - reactivating (UUID: {existing_meeting.id})")
            existing_meeting.is_active = True
            # Only set actual_join_time on first join, not on rejoins
            if not existing_meeting.actual_join_time:
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
                invitees_emails=[],
                cohost_emails=[],
                participants_emails=[],
                actual_join_time=datetime.utcnow(),
                is_active=True,
                meeting_type="meeting",
                scheduled_type="meeting"
            )
            
            db.add(new_meeting)
            db.commit()
            db.refresh(new_meeting)
            meeting_uuid = str(new_meeting.id)
            print(f"✅ Test meeting created - UUID: {meeting_uuid}")
        
        # Trigger bot-runner (semaphore limits concurrent joins to 20)
        async with bot_join_semaphore:
            print(f"🤖 Triggering bot-runner for testing (Meeting UUID: {meeting_uuid})...")
            
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
                        "meetingUrl": request.meeting_url,
                        "meetingUuid": meeting_uuid,  # Pass UUID so chunks/speakers work
                        "hostEmail": "test@example.com"
                    }
                    
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
        
        # Broadcast status change to WebSocket subscribers (all IDs)
        try:
            from app.api.websocket import manager
            await manager.broadcast_status(meeting_uuid, request.is_active)  # UUID
            if meeting.original_webex_meeting_id:
                await manager.broadcast_status(meeting.original_webex_meeting_id, request.is_active)  # Original Webex ID (embedded app)
            if meeting.webex_meeting_id and meeting.webex_meeting_id != meeting.original_webex_meeting_id:
                await manager.broadcast_status(meeting.webex_meeting_id, request.is_active)  # Webex ID (may be timestamped)
            print(f"📡 Broadcast status change via WebSocket: {status_text} (UUID + Original Webex ID + Webex ID)")
        except Exception as ws_error:
            # Log error but don't fail the workflow
            print(f"⚠️ Failed to broadcast status via WebSocket: {str(ws_error)}")
        
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

