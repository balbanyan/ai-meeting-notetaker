from groq import Groq
from typing import List
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.speaker_transcript import SpeakerTranscript
from app.models.meeting import Meeting


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


async def generate_meeting_summary(meeting_id, db: Session) -> None:
    """
    Background task to generate meeting summary when bot leaves a meeting.
    
    Args:
        meeting_id: UUID of the meeting
        db: SQLAlchemy database session
    
    This function:
    - Fetches all speaker transcripts for the meeting
    - Generates a comprehensive MoM using LLM
    - Stores the summary in meeting.meeting_summary
    - On error: stores error message in meeting_summary
    """
    try:
        # Get the meeting
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if not meeting:
            print(f"❌ Meeting {meeting_id} not found for summary generation")
            return
        
        print(f"🤖 Generating meeting summary for meeting {meeting_id}")
        
        # Fetch all speaker transcripts ordered chronologically
        transcripts = db.query(SpeakerTranscript).filter(
            SpeakerTranscript.meeting_id == meeting_id
        ).order_by(SpeakerTranscript.start_time.asc()).all()
        
        # Handle case with no transcripts
        if not transcripts:
            meeting.meeting_summary = "No transcripts available - meeting may have had no recorded audio or speech."
            db.commit()
            print(f"⚠️ No transcripts found for meeting {meeting_id}")
            return
        
        # Default system prompt for MoM generation
        system_prompt = (
            "You are an expert meeting assistant. Generate a comprehensive meeting summary including: "
            "1) Key Discussion Points, 2) Decisions Made, 3) Action Items (with owners if mentioned), "
            "4) Next Steps. Be concise and professional."
        )
        
        # Generate summary using LLM
        llm_response = process_transcripts_with_llm(
            transcripts=transcripts,
            system_prompt=system_prompt,
            model=settings.llm_model
        )
        
        # Store the summary
        meeting.meeting_summary = llm_response
        db.commit()
        
        print(f"✅ Meeting summary generated successfully for meeting {meeting_id}")
        
    except Exception as e:
        # Store error message in meeting_summary for debugging
        error_msg = f"Error generating summary: {str(e)}"
        print(f"❌ {error_msg}")
        
        try:
            meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
            if meeting:
                meeting.meeting_summary = error_msg
                db.commit()
        except Exception as commit_error:
            print(f"❌ Failed to store error message: {str(commit_error)}")

