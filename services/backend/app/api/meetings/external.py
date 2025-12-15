from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import verify_external_api_key
from app.models.meeting import Meeting
from app.models.speaker_transcript import SpeakerTranscript
from app.services.llm_processor import process_transcripts_with_llm
from .schemas import (
    ProcessTranscriptsRequest,
    ProcessTranscriptsResponse,
    GetTranscriptsRequest,
    GetTranscriptsResponse,
    TranscriptItem,
)

router = APIRouter()


# ============================================================================
# EXTERNAL API ENDPOINT - Process Transcripts with LLM
# ============================================================================


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

