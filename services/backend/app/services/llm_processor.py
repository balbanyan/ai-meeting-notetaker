from groq import Groq
from typing import List
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.speaker_transcript import SpeakerTranscript
from app.models.meeting import Meeting
from app.core.database import SessionLocal
from app.api.websocket import manager

import logging

logger = logging.getLogger(__name__)


def process_transcripts_with_llm(
    transcripts: List[SpeakerTranscript],
    system_prompt: str,
    model: str = "openai/gpt-oss-120b"
) -> str:
    """
    Process speaker transcripts using Groq's LLM API.
    
    Args:
        transcripts: List of SpeakerTranscript objects ordered by start_time
        system_prompt: System prompt to guide the LLM's processing
        model: Groq model to use (default: openai/gpt-oss-120b)
    
    Returns:
        LLM-generated response string
    """
    # Initialize Groq client
    client = Groq(api_key=settings.groq_api_key)
    
    # Format transcripts into a readable conversation format
    transcript_text = ""
    for transcript in transcripts:
        speaker = transcript.speaker_name or "Unknown Speaker"
        text = transcript.transcript_text
        timestamp = transcript.start_time.strftime("%H:%M:%S")
        transcript_text += f"[{timestamp}] {speaker}: {text}\n"
    
    # Build messages for the LLM
    messages = [
        {
            "role": "system",
            "content": system_prompt
        },
        {
            "role": "user",
            "content": f"Here is the meeting transcript:\n\n{transcript_text}"
        }
    ]
    
    # Call Groq API
    completion = client.chat.completions.create(
        model=model,
        messages=messages
    )
    
    # Extract and return the response
    return completion.choices[0].message.content


async def generate_meeting_summary(meeting_id, db_session: Session) -> None:
    """
    Background task to generate meeting summary when bot leaves a meeting.
    
    Optimized for high concurrency using 3-phase connection management:
    Phase 1: Quick DB read (100ms) → copy data → release connection
    Phase 2: LLM API call (5-30s) WITHOUT holding DB connection
    Phase 3: Quick DB write (50ms) → release connection
    
    Args:
        meeting_id: UUID of the meeting
        db_session: Database session (will be closed and reopened to avoid long hold times)
    
    This function:
    - Fetches all speaker transcripts for the meeting
    - Generates a comprehensive MoM using LLM
    - Stores the summary in meeting.meeting_summary
    - On error: stores error message in meeting_summary
    """
    
    # Phase 1: Quick DB read, copy data, release connection
    db = SessionLocal()
    meeting_data = None
    transcripts_data = []
    
    try:
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if not meeting:
            logger.error(f"❌ Meeting {meeting_id} not found for summary generation")
            return
        
        logger.info(f"🤖 Generating meeting summary for meeting {meeting_id}")
        
        transcripts = db.query(SpeakerTranscript).filter(
            SpeakerTranscript.meeting_id == meeting_id
        ).order_by(SpeakerTranscript.start_time.asc()).all()
        
        if not transcripts:
            meeting.meeting_summary = "No transcripts available - meeting may have had no recorded audio or speech."
            db.commit()
            logger.warning(f"⚠️ No transcripts found for meeting {meeting_id}")
            return
        
        # Copy data needed for LLM call and broadcast
        meeting_data = {
            "id": str(meeting.id),
            "webex_meeting_id": meeting.webex_meeting_id
        }
        transcripts_data = [{
            "speaker_name": t.speaker_name,
            "transcript_text": t.transcript_text,
            "start_time": t.start_time
        } for t in transcripts]
        
    finally:
        db.close() # Release after ~100ms
    
    # Phase 2: LLM API call WITHOUT holding DB connection
    llm_response = ""
    try:
        system_prompt = (
            "You are an expert meeting assistant. Generate a comprehensive meeting summary including: "
            "1) Key Discussion Points, 2) Decisions Made, 3) Action Items (with owners if mentioned), "
            "4) Next Steps. Be concise and professional."
        )
        
        # Reconstruct SpeakerTranscript objects for process_transcripts_with_llm
        # This is a temporary measure until process_transcripts_with_llm is refactored to accept dicts
        temp_transcripts = [
            SpeakerTranscript(
                speaker_name=t['speaker_name'],
                transcript_text=t['transcript_text'],
                start_time=t['start_time']
            ) for t in transcripts_data
        ]

        llm_response = process_transcripts_with_llm(
            transcripts=temp_transcripts,
            system_prompt=system_prompt,
            model=settings.llm_model
        )
        
    except Exception as e:
        error_msg = f"Error generating summary: {str(e)}"
        logger.error(f"❌ {error_msg}")
        llm_response = error_msg # Store error in summary
    
    # Phase 3: Quick DB write, release connection
    db = SessionLocal()
    try:
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if meeting:
            meeting.meeting_summary = llm_response
            db.commit()
            logger.info(f"✅ Meeting summary generated successfully for meeting {meeting_id}")
        
        # Broadcast summary via WebSocket to both IDs
        if meeting_data:
            manager.broadcast_summary_sync(meeting_data["id"], llm_response)  # UUID
            if meeting_data["webex_meeting_id"]:
                manager.broadcast_summary_sync(meeting_data["webex_meeting_id"], llm_response)  # Webex ID
            logger.info(f"📡 Broadcasted summary via WebSocket to subscribers (Webex ID + UUID)")
        
    except Exception as e:
        logger.error(f"❌ Failed to store or broadcast summary for meeting {meeting_id}: {str(e)}")
    finally:
        db.close() # Release after ~50ms
