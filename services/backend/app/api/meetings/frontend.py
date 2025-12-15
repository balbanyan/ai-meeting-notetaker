from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import case, desc
import uuid
from app.core.database import get_db
from app.models.meeting import Meeting
from app.models.speaker_transcript import SpeakerTranscript
from .schemas import (
    MeetingListItem,
    MeetingsListResponse,
    MeetingDetailsTranscript,
    MeetingDetailsResponse,
    MeetingStatusResponse,
)

router = APIRouter()


# ============================================================================
# FRONTEND API ENDPOINTS - Meeting List & Details
# ============================================================================


@router.get("/meetings/list", response_model=MeetingsListResponse)
async def list_meetings(db: Session = Depends(get_db)):
    """
    Get all meetings (both active and completed) for the frontend dashboard.
    
    Returns meetings ordered by most recent first:
    - Active meetings: ordered by actual_join_time DESC
    - Completed meetings: ordered by actual_leave_time DESC
    No authentication required - matches embedded app pattern.
    """
    try:
        print(f"📋 LIST MEETINGS: fetching all meetings (active and completed)")
        
        # Query all meetings (both active and inactive)
        # Order by: active meetings first (by join time), then completed meetings (by leave time)
        meetings = db.query(Meeting).order_by(
            # First, sort by is_active (True first, False second)
            desc(Meeting.is_active),
            # Then within each group, sort by appropriate time
            # For active: use actual_join_time DESC
            # For inactive: use actual_leave_time DESC
            desc(case(
                (Meeting.is_active == True, Meeting.actual_join_time),
                else_=Meeting.actual_leave_time
            ))
        ).all()
        
        active_count = sum(1 for m in meetings if m.is_active)
        completed_count = len(meetings) - active_count
        
        print(f"✅ Found {len(meetings)} meeting(s): {active_count} active, {completed_count} completed")
        
        # Build response items
        meeting_items = []
        for meeting in meetings:
            item = MeetingListItem(
                meeting_uuid=str(meeting.id),
                webex_meeting_id=meeting.webex_meeting_id,
                original_webex_meeting_id=meeting.original_webex_meeting_id,
                meeting_number=meeting.meeting_number,
                meeting_title=meeting.meeting_title,
                host_email=meeting.host_email,
                participant_emails=meeting.participant_emails or [],
                cohost_emails=meeting.cohost_emails or [],
                scheduled_start_time=meeting.scheduled_start_time,
                scheduled_end_time=meeting.scheduled_end_time,
                actual_join_time=meeting.actual_join_time,
                actual_leave_time=meeting.actual_leave_time,
                meeting_type=meeting.meeting_type,
                scheduled_type=meeting.scheduled_type,
                meeting_summary=meeting.meeting_summary,
                is_active=meeting.is_active
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


@router.get("/meetings/status/{meeting_identifier}", response_model=MeetingStatusResponse)
async def get_meeting_status(meeting_identifier: str, db: Session = Depends(get_db)):
    """
    Check if a bot is active for a meeting.
    
    Accepts either:
    - UUID: Checks the specific meeting by internal UUID
    - Webex meeting ID: Checks original_webex_meeting_id (matches embedded app meeting ID)
    
    Returns simple status response with is_active boolean.
    No authentication required - matches embedded app pattern.
    """
    try:
        print(f"🔍 GET MEETING STATUS: {meeting_identifier}")
        
        # Try to parse as UUID first
        try:
            uuid_obj = uuid.UUID(meeting_identifier)
            # Find meeting by UUID and check if active
            meeting = db.query(Meeting).filter(
                Meeting.id == uuid_obj,
                Meeting.is_active == True
            ).first()
            is_active = meeting is not None
        except ValueError:
            # Not a UUID - treat as Webex meeting ID and check original_webex_meeting_id
            # Check if any active meetings exist with this original_webex_meeting_id
            active_meeting = db.query(Meeting).filter(
                Meeting.original_webex_meeting_id == meeting_identifier,
                Meeting.is_active == True
            ).first()
            is_active = active_meeting is not None
        
        print(f"✅ Meeting status: {'active' if is_active else 'inactive'}")
        return MeetingStatusResponse(is_active=is_active)
    
    except Exception as e:
        print(f"❌ GET MEETING STATUS FAILED - {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve meeting status: {str(e)}"
        )


@router.get("/meetings/{meeting_uuid}", response_model=MeetingDetailsResponse)
async def get_meeting_details(meeting_uuid: str, db: Session = Depends(get_db)):
    """
    Get detailed meeting information including transcripts for a specific meeting.
    
    Accepts UUID only. Returns full meeting data plus all speaker transcripts ordered chronologically.
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
                id=str(t.id),
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
            original_webex_meeting_id=meeting.original_webex_meeting_id,
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
            scheduled_type=meeting.scheduled_type,
            meeting_summary=meeting.meeting_summary,
            is_active=meeting.is_active,
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

