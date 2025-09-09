from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.auth import verify_bot_token
from app.models.audio_chunk import AudioChunk
from pydantic import BaseModel

router = APIRouter()


class AudioChunkResponse(BaseModel):
    id: str  # UUID now
    meeting_id: str
    chunk_id: int  # Sequential chunk number
    transcription_status: str  # "ready", "processing", "completed", "failed"
    host_email: str = None
    created_at: str
    updated_at: str
    
    class Config:
        from_attributes = True


class SaveChunkResponse(BaseModel):
    status: str
    message: str
    chunk_id: int


@router.post("/audio/chunk", response_model=SaveChunkResponse)
async def save_audio_chunk(
    background_tasks: BackgroundTasks,
    meeting_id: str = Form(...),
    chunk_id: int = Form(...),
    host_email: str = Form(None),
    audio_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """Save an audio chunk from bot-runner"""
    try:
        # Read the audio file
        audio_data = await audio_file.read()
        
        # Create new audio chunk record
        chunk = AudioChunk(
            meeting_id=meeting_id,
            chunk_id=chunk_id,
            chunk_audio=audio_data,
            host_email=host_email,
            transcription_status="ready"  # Ready for transcription
        )
        
        db.add(chunk)
        db.commit()
        db.refresh(chunk)
        
        # Get chunk count for this meeting
        chunk_count = db.query(AudioChunk).filter(AudioChunk.meeting_id == meeting_id).count()
        
        # Detect audio format from content type or file signature
        format_info = ""
        if audio_file.content_type:
            format_info = f", Format: {audio_file.content_type}"
        elif audio_data[:4] == b'\x1a\x45\xdf\xa3':  # WebM signature
            format_info = ", Format: WebM/Opus"
        elif audio_data[:4] == b'RIFF':  # WAV signature
            format_info = ", Format: WAV"
            
        print(f"💾 CHUNK SAVED - Chunk #{chunk_count}, ID: {chunk_id}, Size: {len(audio_data)} bytes{format_info}")
        
        # Trigger background transcription (Immediate Processing)
        from app.services.transcription import transcribe_chunk_async
        background_tasks.add_task(transcribe_chunk_async, str(chunk.id))
        print(f"🔄 TRANSCRIPTION QUEUED - Chunk UUID: {chunk.id}")
        
        return SaveChunkResponse(
            status="saved",
            message=f"Audio chunk saved successfully",
            chunk_id=chunk_id
        )
        
    except Exception as e:
        db.rollback()
        print(f"❌ CHUNK SAVE FAILED - {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save audio chunk: {str(e)}")


@router.get("/audio/chunks/count")
async def get_meeting_chunk_count(meeting_id: str, db: Session = Depends(get_db)):
    """Get the maximum chunk_id for a meeting (for continuing sequence)"""
    try:
        from sqlalchemy import func
        max_chunk_id = db.query(func.max(AudioChunk.chunk_id)).filter(
            AudioChunk.meeting_id == meeting_id
        ).scalar()
        
        # Return 0 if no chunks exist for this meeting
        chunk_count = max_chunk_id if max_chunk_id is not None else 0
        
        return {"meeting_id": meeting_id, "max_chunk_id": chunk_count}
        
    except Exception as e:
        print(f"❌ CHUNK COUNT FAILED - {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get chunk count: {str(e)}")


@router.get("/audio/chunks/{meeting_id}", response_model=List[AudioChunkResponse])
async def get_audio_chunks(meeting_id: str, db: Session = Depends(get_db)):
    """Get all audio chunks for a meeting (for debugging)"""
    chunks = db.query(AudioChunk).filter(AudioChunk.meeting_id == meeting_id).all()
    return chunks
