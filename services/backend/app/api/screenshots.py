from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import Dict, Any
from app.core.database import get_db, SessionLocal
from app.core.auth import verify_bot_token, decode_jwt_token, check_meeting_access
from app.core.config import settings
from app.models.screenshare_capture import ScreenshareCapture
from app.models.audio_chunk import AudioChunk
from app.models.meeting import Meeting
from pydantic import BaseModel
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class SaveScreenshotResponse(BaseModel):
    status: str
    message: str
    screenshot_id: str


@router.post("/screenshots/capture", response_model=SaveScreenshotResponse)
async def save_screenshot(
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
        
        # Queue vision analysis to Celery (persistent task queue)
        from app.tasks.vision import analyze_screenshot
        analyze_screenshot.delay(str(screenshot.id))
        logger.info(f"🔄 Vision analysis queued [Celery] for screenshot: {screenshot.id}")
        
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
    Background task to analyze a screenshot using vision model.
    
    Optimized for high concurrency using 3-phase connection management:
    Phase 1: Quick DB read (20ms) → copy data → release connection
    Phase 2: Vision API call (5-10s) WITHOUT holding DB connection
    Phase 3: Quick DB write (20ms) → release connection
    
    Total connection hold time: ~40ms (vs 5-10 seconds before optimization)
    
    Args:
        screenshot_uuid: UUID of the screenshot to analyze
        vision_service: GroqVisionService instance
    """
    from app.core.database import SessionLocal
    from app.models.screenshare_capture import ScreenshareCapture
    
    # Phase 1: Quick DB read, copy data, release connection
    db = SessionLocal()
    try:
        screenshot = db.query(ScreenshareCapture).filter(ScreenshareCapture.id == screenshot_uuid).first()
        
        if not screenshot or not screenshot.screenshot_image:
            logger.error(f"❌ Screenshot {screenshot_uuid} not found or has no image data")
            return
        
        # Update status to processing
        screenshot.analysis_status = "processing"
        db.commit()
        
        # Copy data we need (so we can release the connection)
        screenshot_image = screenshot.screenshot_image
        screenshot_id = screenshot.id
        
        logger.info(f"🔄 Starting vision analysis for screenshot: {screenshot_id}")
    finally:
        db.close()  # Release after ~20ms
    
    # Phase 2: Vision API call WITHOUT holding DB connection (5-10 seconds)
    try:
        result = await vision_service.analyze_screenshot(screenshot_image)
        
        if not result['success']:
            raise Exception(f"Vision analysis failed: {result['error']}")
            
    except Exception as e:
        # Mark as failed in database
        db = SessionLocal()
        try:
            screenshot = db.query(ScreenshareCapture).filter(ScreenshareCapture.id == screenshot_id).first()
            if screenshot:
                screenshot.analysis_status = "failed"
                db.commit()
        finally:
            db.close()
        
        logger.error(f"❌ Vision analysis failed for screenshot: {screenshot_id}: {str(e)}")
        return
    
    # Phase 3: Quick DB write, release connection
    db = SessionLocal()
    try:
        screenshot = db.query(ScreenshareCapture).filter(ScreenshareCapture.id == screenshot_id).first()
        if screenshot:
            screenshot.vision_analysis = result['analysis']
            screenshot.vision_model_used = result.get('model_used', settings.vision_model)
            screenshot.analysis_status = "completed"
            db.commit()
            
            logger.info(f"✅ Vision analysis completed for screenshot: {screenshot_id} ({len(result['analysis'])} chars)")
    finally:
        db.close()  # Release after ~20ms


@router.get("/screenshots/image/{screenshot_id}")
async def get_screenshot_image(
    screenshot_id: str,
    db: Session = Depends(get_db),
    user: Dict[str, Any] = Depends(decode_jwt_token)
):
    """
    Serve screenshot PNG image by ID.
    Used by external applications to fetch screenshot images via URL reference.
    
    Requires JWT authentication. User must have access to the meeting
    that the screenshot belongs to.
    """
    user_email = user.get("email", "")
    
    screenshot = db.query(ScreenshareCapture).filter(
        ScreenshareCapture.id == screenshot_id
    ).first()
    
    if not screenshot:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    
    # Get the meeting to check access
    meeting = db.query(Meeting).filter(Meeting.id == screenshot.meeting_id).first()
    
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    
    # Check user has access to this meeting
    if not check_meeting_access(user_email, meeting):
        raise HTTPException(status_code=403, detail="Access denied to this screenshot")
    
    if not screenshot.screenshot_image:
        raise HTTPException(status_code=404, detail="Screenshot image data not available")
    
    return Response(
        content=screenshot.screenshot_image,
        media_type="image/png"
    )
