from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.models.entities import Summary, Meeting
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()


# Pydantic models
class SummaryResponse(BaseModel):
    id: UUID
    summary_type: str
    content: str
    version: int
    generated_by: str
    generated_at: datetime

    class Config:
        from_attributes = True


class GenerateSummaryRequest(BaseModel):
    summary_type: str = "narrative"  # narrative, bullet_points, decisions
    force_regenerate: bool = False


class ChatRequest(BaseModel):
    question: str
    context_window: Optional[int] = 5  # Number of relevant chunks to include


class ChatResponse(BaseModel):
    answer: str
    sources: List[dict]
    meeting_id: UUID


@router.get("/meetings/{meeting_id}/summary", response_model=List[SummaryResponse])
async def get_meeting_summaries(meeting_id: UUID, db: Session = Depends(get_db)):
    """Get all summaries for a meeting"""
    
    # Verify meeting exists
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    summaries = db.query(Summary).filter(
        Summary.meeting_id == meeting_id
    ).order_by(Summary.generated_at.desc()).all()
    
    return summaries


@router.get("/meetings/{meeting_id}/summary/{summary_type}", response_model=SummaryResponse)
async def get_meeting_summary_by_type(
    meeting_id: UUID, 
    summary_type: str,
    db: Session = Depends(get_db)
):
    """Get the latest summary of a specific type for a meeting"""
    
    summary = db.query(Summary).filter(
        Summary.meeting_id == meeting_id,
        Summary.summary_type == summary_type
    ).order_by(Summary.version.desc()).first()
    
    if not summary:
        raise HTTPException(
            status_code=404, 
            detail=f"No {summary_type} summary found for this meeting"
        )
    
    return summary


@router.post("/meetings/{meeting_id}/summary:generate")
async def generate_summary(
    meeting_id: UUID,
    request: GenerateSummaryRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Generate a new summary for a meeting"""
    
    # Verify meeting exists
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Check if summary already exists
    existing_summary = db.query(Summary).filter(
        Summary.meeting_id == meeting_id,
        Summary.summary_type == request.summary_type
    ).first()
    
    if existing_summary and not request.force_regenerate:
        return {
            "status": "exists",
            "message": "Summary already exists. Use force_regenerate=true to recreate.",
            "summary_id": existing_summary.id
        }
    
    # Enqueue summary generation job
    from app.core.queue import enqueue_job
    from app.workers.summary_worker import generate_meeting_summary
    
    job = enqueue_job(
        'summary',
        generate_meeting_summary,
        str(meeting_id),
        request.summary_type
    )
    
    return {
        "status": "queued",
        "message": f"Summary generation queued for meeting {meeting_id}",
        "summary_type": request.summary_type,
        "job_id": job.id
    }


@router.post("/chat/rag", response_model=ChatResponse)
async def chat_with_meeting(
    meeting_id: UUID,
    request: ChatRequest,
    db: Session = Depends(get_db)
):
    """Chat with meeting content using RAG (Retrieval Augmented Generation)"""
    
    # Verify meeting exists
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Implement RAG functionality using embedding worker
    from app.workers.embedding_worker import generate_rag_response
    
    try:
        rag_result = generate_rag_response(request.question, str(meeting_id))
        
        if rag_result["status"] == "success":
            return ChatResponse(
                answer=rag_result["answer"],
                sources=rag_result["sources"],
                meeting_id=meeting_id
            )
        else:
            return ChatResponse(
                answer=rag_result.get("answer", "I encountered an error while searching the meeting content."),
                sources=[],
                meeting_id=meeting_id
            )
    except Exception as e:
        return ChatResponse(
            answer=f"I encountered an error while processing your question: {str(e)}",
            sources=[],
            meeting_id=meeting_id
        )


# Placeholder for background task functions
async def generate_summary_task(meeting_id: UUID, summary_type: str):
    """Background task to generate summary"""
    # TODO: Implement summary generation using LLM
    # 1. Fetch all transcript segments for the meeting
    # 2. Combine into context
    # 3. Call LLM (Groq/OpenAI) with appropriate prompt
    # 4. Save generated summary to database
    # 5. Generate embeddings for RAG
    pass
