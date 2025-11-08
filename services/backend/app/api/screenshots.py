from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.core.auth import verify_bot_token
from app.core.config import settings
from app.models.screenshare_capture import ScreenshareCapture
from app.models.audio_chunk import AudioChunk
from app.models.meeting import Meeting
from pydantic import BaseModel
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class ScreenshotResponse(BaseModel):
    id: str
    meeting_id: str
    chunk_id: int
    analysis_status: str
    captured_at: str
    created_at: str
    
    class Config:
        from_attributes = True


class SaveScreenshotResponse(BaseModel):
    status: str
    message: str
    screenshot_id: str


@router.post("/screenshots/capture", response_model=SaveScreenshotResponse)
async def save_screenshot(
    background_tasks: BackgroundTasks,
    meeting_id: str = Form(...),
    chunk_id: int = Form(...),
    captured_at: str = Form(...),
    screenshot_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    token: str = Depends(verify_bot_token)
):
    """Save a screenshot from bot-runner"""
    try:
        # Verify meeting exists and has screenshots enabled
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        if not meeting:
            raise HTTPException(status_code=404, detail=f"Meeting {meeting_id} not found")
        
        if not meeting.screenshots_enabled and not settings.enable_screenshots:
            logger.warning(f"Screenshot received but feature is disabled for meeting {meeting_id}")
            # Still save it, but log the inconsistency
        
        # Read the screenshot file
        screenshot_data = await screenshot_file.read()
        
        # Parse captured_at timestamp
        parsed_captured_at = datetime.fromisoformat(captured_at.replace('Z', '+00:00'))
        
        # Find the corresponding audio chunk
        audio_chunk = db.query(AudioChunk).filter(
            AudioChunk.meeting_id == meeting_id,
            AudioChunk.chunk_id == chunk_id
        ).first()
        
        if not audio_chunk:
            raise HTTPException(status_code=404, detail=f"Audio chunk {chunk_id} not found for meeting {meeting_id}")
        
        # Create new screenshot record
        screenshot = ScreenshareCapture(
            meeting_id=meeting_id,
            audio_chunk_id=audio_chunk.id,
            chunk_id=chunk_id,
            screenshot_image=screenshot_data,
            image_format='png',
            analysis_status='pending',
            captured_at=parsed_captured_at
        )
        
        db.add(screenshot)
        db.commit()
        db.refresh(screenshot)
        
        logger.info(f"📸 Screenshot saved - Meeting: {meeting_id}, Chunk: {chunk_id}, Size: {len(screenshot_data)} bytes")
        
        # Trigger background vision analysis
        from app.services.vision_service import groq_vision_service
        background_tasks.add_task(analyze_screenshot_async, str(screenshot.id), groq_vision_service)
        logger.info(f"🔄 Vision analysis queued for screenshot: {screenshot.id}")
        
        return SaveScreenshotResponse(
            status="saved",
            message=f"Screenshot saved successfully",
            screenshot_id=str(screenshot.id)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Screenshot save failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save screenshot: {str(e)}")


async def analyze_screenshot_async(screenshot_uuid: str, vision_service):
    """
    Background task to analyze a screenshot using vision model
    
    Args:
        screenshot_uuid: UUID of the screenshot to analyze
        vision_service: GroqVisionService instance
    """
    from app.core.database import SessionLocal
    
    db = SessionLocal()
    try:
        # Get the screenshot from database
        screenshot = db.query(ScreenshareCapture).filter(ScreenshareCapture.id == screenshot_uuid).first()
        
        if not screenshot:
            logger.error(f"❌ Screenshot {screenshot_uuid} not found in database")
            return
        
        if not screenshot.screenshot_image:
            logger.error(f"❌ Screenshot {screenshot_uuid} has no image data")
            return
        
        # Update status to processing
        screenshot.analysis_status = "processing"
        db.commit()
        
        logger.info(f"🔄 Starting vision analysis for screenshot: {screenshot.id}")
        
        # Analyze using Groq vision service
        result = await vision_service.analyze_screenshot(screenshot.screenshot_image)
        
        # Update database with result
        if result['success']:
            screenshot.vision_analysis = result['analysis']
            screenshot.vision_model_used = result.get('model_used', settings.vision_model)
            screenshot.analysis_status = "completed"
            
            db.commit()
            
            logger.info(f"✅ Vision analysis completed for screenshot: {screenshot.id} ({len(result['analysis'])} chars)")
        else:
            screenshot.analysis_status = "failed"
            db.commit()
            logger.error(f"❌ Vision analysis failed for screenshot: {screenshot.id}: {result['error']}")
        
    except Exception as e:
        # Mark as failed on any error
        if 'screenshot' in locals():
            screenshot.analysis_status = "failed"
            db.commit()
        
        logger.error(f"❌ Background vision analysis failed for screenshot {screenshot_uuid}: {str(e)}")
        
    finally:
        db.close()


@router.get("/screenshots/{meeting_id}", response_model=List[ScreenshotResponse])
async def get_screenshots(meeting_id: str, db: Session = Depends(get_db)):
    """Get all screenshots for a meeting (for debugging)"""
    screenshots = db.query(ScreenshareCapture).filter(
        ScreenshareCapture.meeting_id == meeting_id
    ).all()
    return screenshots
