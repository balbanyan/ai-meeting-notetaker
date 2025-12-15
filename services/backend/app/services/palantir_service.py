import httpx
import logging
from datetime import datetime
from typing import Optional, List
from difflib import SequenceMatcher
from sqlalchemy.orm import Session
from app.core.config import settings

logger = logging.getLogger(__name__)


class PalantirService:
    """Service for sending transcript data to Palantir API"""
    
    def __init__(self):
        self.token = settings.palantir_token
        self.url = settings.live_demo_url
        self.enabled = settings.send_palantir
    
    def send_transcript(
        self,
        speaker_name: str,
        transcript_text: str,
        start_time: datetime,
        end_time: datetime
    ) -> bool:
        """
        Send speaker transcript to Palantir API.
        
        Args:
            speaker_name: Name of the speaker
            transcript_text: The transcript text
            start_time: When the segment started
            end_time: When the segment ended
            
        Returns:
            True if successful, False otherwise
        """
        # Check if Palantir integration is enabled
        if not self.enabled:
            logger.debug("Palantir integration is disabled (SEND_PALANTIR=False)")
            return False
        
        # Validate configuration
        if not self.token or not self.url:
            logger.warning("Palantir integration enabled but missing PALANTIR_TOKEN or LIVE_DEMO_URL")
            return False
        
        try:
            # Format the transcription as "Speaker Name: transcript text"
            formatted_transcript = f"{speaker_name}: {transcript_text}"
            
            # Convert datetime objects to ISO 8601 format
            start_time_iso = start_time.isoformat()
            end_time_iso = end_time.isoformat()
            
            # Prepare the request payload
            payload = {
                "parameters": {
                    "start_time": start_time_iso,
                    "end_time": end_time_iso,
                    "transcription": formatted_transcript
                }
            }
            
            # Prepare headers
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}"
            }
            
            # Log the request
            logger.info(f"📤 Sending transcript to Palantir: {speaker_name} ({start_time_iso} - {end_time_iso})")
            
            # Send the request
            with httpx.Client(timeout=10.0) as client:
                response = client.post(
                    self.url,
                    json=payload,
                    headers=headers
                )
            
            # Check response status
            if response.status_code == 200 or response.status_code == 201:
                logger.info(f"✅ Successfully sent transcript to Palantir: {speaker_name}")
                return True
            else:
                logger.error(
                    f"❌ Palantir API returned status {response.status_code}: {response.text}"
                )
                return False
                
        except httpx.TimeoutException:
            logger.error("❌ Palantir API request timed out")
            return False
        except httpx.RequestError as e:
            logger.error(f"❌ Palantir API request failed: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"❌ Unexpected error sending to Palantir: {str(e)}")
            return False
    
    async def send_non_voting_request(
        self,
        meeting_summary: str,
        recent_transcription: str,
        shown_slide: str,
        meeting_id: str = None
    ) -> Optional[dict]:
        """
        Send incremental data to Non-Voting Assistant API.
        
        Args:
            meeting_summary: Summary of meeting (can be recent or cumulative)
            recent_transcription: NEW transcripts since last call (formatted)
            shown_slide: NEW unique slide summaries since last call
            meeting_id: Optional meeting UUID for logging
            
        Returns:
            dict with suggested_questions, quotes, strategic_interventions, non_voting_opinions
        """
        if not settings.enable_non_voting:
            logger.debug("Non-voting assistant is disabled (ENABLE_NON_VOTING=False)")
            return None
        
        if not settings.non_voting_assistant_url or not self.token:
            logger.warning("Non-voting enabled but missing NON_VOTING_ASSISTANT_URL or PALANTIR_TOKEN")
            return None
        
        try:
            payload = {
                "parameters": {
                    "meetingSummary": meeting_summary,
                    "recentTranscription": recent_transcription,
                    "shownSlide": shown_slide
                }
            }
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}"
            }
            
            meeting_log = f" (Meeting: {meeting_id})" if meeting_id else ""
            logger.info(f"📤 Sending non-voting request to Palantir API{meeting_log}")
            logger.debug(f"   Payload size - Summary: {len(meeting_summary)} chars, Transcription: {len(recent_transcription)} chars, Slides: {len(shown_slide)} chars")
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    settings.non_voting_assistant_url,
                    json=payload,
                    headers=headers
                )
            
            if response.status_code in [200, 201]:
                response_data = response.json()
                response_value = response_data.get('value', {})
                meeting_log = f" (Meeting: {meeting_id})" if meeting_id else ""
                logger.info(f"✅ Successfully received non-voting assistant response{meeting_log}")
                logger.info(f"   Response contains: {len(response_value.get('suggested_questions', []))} questions, {len(response_value.get('quotes', []))} quotes, {len(response_value.get('engagement_points', []))} engagement points, {len(response_value.get('non_voting_opinions', []))} opinions{meeting_log}")
                return response_data
            else:
                logger.error(f"❌ Non-voting API returned status {response.status_code}")
                logger.error(f"   Response: {response.text[:500]}")  # First 500 chars
                return None
                
        except httpx.TimeoutException:
            logger.error(f"❌ Non-voting API request timed out")
            logger.error(f"   This usually means the API is taking too long to respond or is unreachable")
            return None
        except httpx.ConnectError as e:
            logger.error(f"❌ Cannot connect to non-voting API")
            logger.error(f"   Error: {str(e)}")
            logger.error(f"   Check if the URL is correct and the service is running")
            return None
        except httpx.RequestError as e:
            logger.error(f"❌ Non-voting API request failed")
            logger.error(f"   Error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"❌ Unexpected error calling non-voting API: {str(e)}")
            logger.error(f"   Exception type: {type(e).__name__}")
            return None
    
    def deduplicate_slides(self, slides: List) -> List:
        """
        Remove duplicate slides using text similarity on vision_analysis.
        Uses 80% similarity threshold.
        
        Args:
            slides: List of ScreenshareCapture objects ordered by captured_at
            
        Returns:
            List of unique ScreenshareCapture objects
        """
        if not slides:
            return []
        
        unique_slides = [slides[0]]  # First slide is always unique
        
        for current in slides[1:]:
            last_unique = unique_slides[-1]
            
            # Calculate text similarity
            similarity = SequenceMatcher(
                None,
                last_unique.vision_analysis or "",
                current.vision_analysis or ""
            ).ratio()
            
            # If similarity < 80%, it's a new slide
            if similarity < 0.80:
                unique_slides.append(current)
            else:
                logger.debug(f"Skipping duplicate slide (similarity: {similarity:.2%})")
        
        logger.info(f"📊 Deduplicated slides: {len(slides)} → {len(unique_slides)} unique")
        return unique_slides
    
    async def trigger_non_voting_checkpoint(
        self,
        meeting_id: str,
        chunk_id: int,
        db: Session
    ):
        """
        Complete workflow: aggregate incremental data, call API, store, broadcast.
        
        Optimized for high concurrency using 3-phase connection management:
        Phase 1: Quick DB read (250ms) → copy data → release connection
        Phase 2: CPU + I/O work (10-60s) WITHOUT holding DB connection
        Phase 3: Quick DB write (50ms) → release connection
        
        Total connection hold time: ~300ms (vs 10-60+ seconds before optimization)
        
        Steps:
        1. Get NEW transcripts since last call
        2. Get NEW screenshots since last call
        3. Deduplicate slides
        4. Call API
        5. Store response
        6. Broadcast via WebSocket with URLs
        
        Args:
            meeting_id: UUID of the meeting
            chunk_id: Current chunk number that triggered this checkpoint
            db: Database session (will be closed and reopened to avoid long hold times)
        """
        try:
            from app.core.database import SessionLocal
            from app.models.non_voting_assistant import NonVotingAssistantResponse
            from app.models.speaker_transcript import SpeakerTranscript
            from app.models.screenshare_capture import ScreenshareCapture
            
            logger.info(f"🎯 Starting non-voting checkpoint for meeting {meeting_id} at chunk {chunk_id}")
            
            # Phase 1: Quick DB read, copy data, release connection
            # Close the passed-in db session (if any) and create a fresh one for quick read
            if db is not None:
                db.close()
            db = SessionLocal()
            
            try:
                # Get last checkpoint time
                last_response = db.query(NonVotingAssistantResponse)\
                    .filter(NonVotingAssistantResponse.meeting_id == meeting_id)\
                    .order_by(NonVotingAssistantResponse.created_at.desc())\
                    .first()
                
                last_checkpoint_time = last_response.created_at if last_response else None
                
                if last_checkpoint_time:
                    logger.info(f"📅 Last checkpoint: {last_checkpoint_time} (Meeting: {meeting_id})")
                else:
                    logger.info(f"📅 First checkpoint for this meeting (Meeting: {meeting_id})")
                
                # 1. Get NEW transcripts
                query = db.query(SpeakerTranscript)\
                    .filter(SpeakerTranscript.meeting_id == meeting_id)
                
                if last_checkpoint_time:
                    query = query.filter(SpeakerTranscript.created_at > last_checkpoint_time)
                
                new_transcripts = query.order_by(SpeakerTranscript.start_time).all()
                logger.info(f"📝 Found {len(new_transcripts)} new transcripts (Meeting: {meeting_id})")
                
                # Copy transcript data (to avoid lazy loading issues after connection closes)
                transcripts_data = [{
                    'speaker_name': t.speaker_name,
                    'transcript_text': t.transcript_text,
                    'start_time': t.start_time
                } for t in new_transcripts]
                
                # 2. Get NEW screenshots
                screenshot_query = db.query(ScreenshareCapture)\
                    .filter(
                        ScreenshareCapture.meeting_id == meeting_id,
                        ScreenshareCapture.vision_analysis.isnot(None)
                    )
                
                if last_checkpoint_time:
                    screenshot_query = screenshot_query.filter(
                        ScreenshareCapture.created_at > last_checkpoint_time
                    )
                
                new_screenshots = screenshot_query.order_by(ScreenshareCapture.captured_at).all()
                logger.info(f"📸 Found {len(new_screenshots)} new screenshots (Meeting: {meeting_id})")
                
                # Copy screenshot data (to avoid lazy loading issues)
                screenshots_data = [{
                    'id': str(s.id),
                    'vision_analysis': s.vision_analysis,
                    'captured_at': s.captured_at
                } for s in new_screenshots]
                
            finally:
                db.close()  # Release after ~250ms
            
            # Phase 2: CPU-intensive work + HTTP I/O WITHOUT holding DB connection
            
            # Format transcripts for API
            transcript_text = "\n".join([
                f"{t['speaker_name']}: {t['transcript_text']}"
                for t in transcripts_data
            ])
            
            # 3. Deduplicate slides (CPU work)
            unique_slides_data = self._deduplicate_slides_from_data(screenshots_data)
            
            slide_text = "\n".join([
                f"[{s['captured_at']}] {s['vision_analysis']}"
                for s in unique_slides_data
            ])
            
            # 4. Generate meeting summary
            meeting_summary = transcript_text[:5000]  # Limit size
            
            # 5. Call Palantir API (10-60 seconds I/O - no DB connection held!)
            logger.info(f"📤 Calling non-voting assistant API for meeting {meeting_id} at chunk {chunk_id}")
            api_response = await self.send_non_voting_request(
                meeting_summary=meeting_summary,
                recent_transcription=transcript_text,
                shown_slide=slide_text,
                meeting_id=meeting_id
            )
            
            if not api_response:
                logger.error(f"❌ Non-voting API call failed for meeting {meeting_id} at chunk {chunk_id}")
                return
            
            logger.info(f"✅ Non-voting API response received for meeting {meeting_id}")
            
            # Phase 3: Quick DB write, release connection
            db = SessionLocal()
            try:
                # 6. Store in database
                response_value = api_response.get('value', {})
                
                db_record = NonVotingAssistantResponse(
                    meeting_id=meeting_id,
                    triggered_at_chunk_id=chunk_id,
                    transcript_count=len(transcripts_data),
                    unique_slide_count=len(unique_slides_data),
                    screenshot_ids=[s['id'] for s in unique_slides_data],
                    suggested_questions=response_value.get('suggested_questions', []),
                    quotes=response_value.get('quotes', []),
                    engagement_points=response_value.get('engagement_points', []),
                    non_voting_opinions=response_value.get('non_voting_opinions', []),
                    api_response_status='completed'
                )
                
                db.add(db_record)
                db.commit()
                logger.info(f"💾 Stored non-voting response in database for meeting {meeting_id}")
                logger.info(f"   Questions: {len(response_value.get('suggested_questions', []))}, Quotes: {len(response_value.get('quotes', []))}, Engagement Points: {len(response_value.get('engagement_points', []))}, Opinions: {len(response_value.get('non_voting_opinions', []))}")
            finally:
                db.close()  # Release after ~50ms
            
            # 7. Broadcast via WebSocket (no DB connection needed)
            from app.api.websocket import manager
            
            broadcast_data = {
                "meeting_id": str(meeting_id),
                "triggered_at_chunk_id": chunk_id,
                "timestamp": datetime.now().isoformat(),
                "suggested_questions": response_value.get('suggested_questions', []),
                "quotes": response_value.get('quotes', []),
                "engagement_points": response_value.get('engagement_points', []),
                "non_voting_opinions": response_value.get('non_voting_opinions', []),
                "new_transcripts": [
                    {
                        "timestamp": t['start_time'].isoformat(),
                        "speaker_name": t['speaker_name'],
                        "transcript": t['transcript_text']
                    }
                    for t in transcripts_data
                ],
                "new_slides": [
                    {
                        "screenshot_id": s['id'],
                        "screenshot_url": f"/screenshots/image/{s['id']}",
                        "analysis": s['vision_analysis'],
                        "captured_at": s['captured_at'].isoformat()
                    }
                    for s in unique_slides_data
                ],
                "unique_slide_count": len(unique_slides_data)
            }
            
            manager.broadcast_non_voting_assistant_sync(str(meeting_id), broadcast_data)
            logger.info(f"📡 Broadcasted non-voting response via WebSocket for meeting {meeting_id}")
            logger.info(f"   Sent {len(transcripts_data)} transcripts and {len(unique_slides_data)} unique slides to subscribers (Meeting: {meeting_id})")
            
            logger.info(f"✅ Non-voting checkpoint completed successfully for meeting {meeting_id} at chunk {chunk_id}")
            
        except Exception as e:
            logger.error(f"❌ Non-voting checkpoint failed for meeting {meeting_id} at chunk {chunk_id}: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
    
    def _deduplicate_slides_from_data(self, slides_data: List[dict]) -> List[dict]:
        """
        Remove duplicate slides using text similarity on vision_analysis.
        Uses 80% similarity threshold.
        
        Works with plain dict data (no SQLAlchemy objects) for use after DB connection closes.
        
        Args:
            slides_data: List of dicts with 'id', 'vision_analysis', 'captured_at' keys
            
        Returns:
            List of unique slide dicts
        """
        if not slides_data:
            return []
        
        unique_slides = [slides_data[0]]  # First slide is always unique
        
        for current in slides_data[1:]:
            last_unique = unique_slides[-1]
            
            # Calculate text similarity
            similarity = SequenceMatcher(
                None,
                last_unique.get('vision_analysis') or "",
                current.get('vision_analysis') or ""
            ).ratio()
            
            # If similarity < 80%, it's a new slide
            if similarity < 0.80:
                unique_slides.append(current)
            else:
                logger.debug(f"Skipping duplicate slide (similarity: {similarity:.2%})")
        
        logger.info(f"📊 Deduplicated slides: {len(slides_data)} → {len(unique_slides)} unique")
        return unique_slides


# Singleton instance
palantir_service = PalantirService()

