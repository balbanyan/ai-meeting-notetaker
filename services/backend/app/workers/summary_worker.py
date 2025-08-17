from uuid import UUID
from datetime import datetime
from typing import List, Dict
import json

from openai import OpenAI
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.entities import Summary, TranscriptSegment, Meeting, JobRun


def generate_meeting_summary(meeting_id: str, summary_type: str = "narrative") -> dict:
    """
    Generate a meeting summary using OpenAI
    
    Args:
        meeting_id: UUID of the meeting
        summary_type: Type of summary (narrative, bullet_points, decisions)
    
    Returns:
        dict: Summary generation results
    """
    db = SessionLocal()
    job_run = None
    
    try:
        # Create job run record
        job_run = JobRun(
            job_type="summary",
            meeting_id=UUID(meeting_id),
            status="running",
            input_data=f"summary_type: {summary_type}",
            started_at=datetime.utcnow()
        )
        db.add(job_run)
        db.commit()
        db.refresh(job_run)
        
        # Get meeting info
        meeting = db.query(Meeting).filter(Meeting.id == UUID(meeting_id)).first()
        if not meeting:
            raise ValueError(f"Meeting {meeting_id} not found")
        
        # Get all transcript segments for the meeting, ordered by time
        segments = db.query(TranscriptSegment).filter(
            TranscriptSegment.meeting_id == UUID(meeting_id)
        ).order_by(TranscriptSegment.start_ms).all()
        
        if not segments:
            raise ValueError(f"No transcript segments found for meeting {meeting_id}")
        
        # Combine transcript segments into full text
        full_transcript = "\n".join([
            f"[{segment.start_ms//1000//60:02d}:{(segment.start_ms//1000)%60:02d}] {segment.text}"
            for segment in segments
        ])
        
        # Generate summary using OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        # Define prompts for different summary types
        prompts = {
            "narrative": """
Please provide a comprehensive narrative summary of this meeting transcript. 
Include the main topics discussed, key decisions made, and important insights shared.
Structure it as a flowing narrative that captures the essence of the meeting.

Meeting Title: {title}
Meeting Duration: {duration} minutes

Transcript:
{transcript}

Please provide a well-structured narrative summary:
""",
            "bullet_points": """
Please analyze this meeting transcript and provide a structured summary in bullet points.
Organize the information into clear sections with key points.

Meeting Title: {title}
Meeting Duration: {duration} minutes

Transcript:
{transcript}

Please provide a bullet-point summary with these sections:
• Key Topics Discussed
• Important Decisions Made
• Action Items
• Next Steps
""",
            "decisions": """
Please extract and summarize all decisions made during this meeting.
Focus on concrete decisions, action items, and commitments.

Meeting Title: {title}
Meeting Duration: {duration} minutes

Transcript:
{transcript}

Please provide a summary focused on:
1. Decisions Made
2. Action Items Assigned
3. Deadlines and Commitments
4. Next Steps
"""
        }
        
        # Calculate meeting duration
        duration_ms = segments[-1].end_ms - segments[0].start_ms if segments else 0
        duration_minutes = duration_ms // 60000
        
        # Get the appropriate prompt
        prompt_template = prompts.get(summary_type, prompts["narrative"])
        prompt = prompt_template.format(
            title=meeting.title or "Meeting",
            duration=duration_minutes,
            transcript=full_transcript[:4000]  # Limit transcript length for API
        )
        
        # Generate summary using OpenAI
        response = client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert meeting assistant that creates clear, concise, and useful meeting summaries. Focus on extracting the most important information and presenting it in a well-structured format."
                },
                {
                    "role": "user", 
                    "content": prompt
                }
            ],
            max_tokens=1500,
            temperature=0.3
        )
        
        summary_content = response.choices[0].message.content
        
        # Check if summary already exists and update version
        existing_summary = db.query(Summary).filter(
            Summary.meeting_id == UUID(meeting_id),
            Summary.summary_type == summary_type
        ).order_by(Summary.version.desc()).first()
        
        new_version = (existing_summary.version + 1) if existing_summary else 1
        
        # Create new summary record
        summary = Summary(
            meeting_id=UUID(meeting_id),
            summary_type=summary_type,
            content=summary_content,
            version=new_version,
            generated_by=f"openai-{settings.LLM_MODEL}",
            generated_at=datetime.utcnow()
        )
        db.add(summary)
        
        # Update job run with success
        job_run.status = "completed"
        job_run.output_data = f"Generated {summary_type} summary (version {new_version})"
        job_run.completed_at = datetime.utcnow()
        
        db.commit()
        db.refresh(summary)
        
        # Schedule embedding generation for the summary
        from app.core.queue import enqueue_job
        enqueue_job('embedding', generate_summary_embeddings, str(summary.id))
        
        return {
            "status": "success",
            "summary_id": str(summary.id),
            "summary_type": summary_type,
            "version": new_version,
            "content": summary_content,
            "job_id": str(job_run.id)
        }
    
    except Exception as e:
        # Update job run with error
        if job_run:
            job_run.status = "failed"
            job_run.error_message = str(e)
            job_run.completed_at = datetime.utcnow()
            db.commit()
        
        return {
            "status": "error",
            "error": str(e),
            "job_id": str(job_run.id) if job_run else None
        }
    
    finally:
        db.close()


def generate_all_summary_types(meeting_id: str) -> dict:
    """Generate all types of summaries for a meeting"""
    results = {}
    
    for summary_type in ["narrative", "bullet_points", "decisions"]:
        result = generate_meeting_summary(meeting_id, summary_type)
        results[summary_type] = result
    
    return {
        "status": "completed",
        "meeting_id": meeting_id,
        "summaries": results
    }


def generate_summary_embeddings(summary_id: str):
    """Generate embeddings for a summary"""
    from app.workers.embedding_worker import generate_embeddings_for_text
    
    db = SessionLocal()
    try:
        summary = db.query(Summary).filter(Summary.id == UUID(summary_id)).first()
        if not summary:
            return {"status": "summary_not_found"}
        
        # Generate embeddings for the summary content
        return generate_embeddings_for_text(
            text=summary.content,
            chunk_type="summary",
            meeting_id=str(summary.meeting_id),
            metadata={
                "summary_id": str(summary.id),
                "summary_type": summary.summary_type,
                "version": summary.version
            }
        )
    
    finally:
        db.close()
