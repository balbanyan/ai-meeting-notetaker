from groq import Groq
from typing import List
from app.core.config import settings
from app.models.speaker_transcript import SpeakerTranscript


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

