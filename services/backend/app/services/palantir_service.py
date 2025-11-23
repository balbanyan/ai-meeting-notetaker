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
        shown_slide: str
    ) -> Optional[dict]:
        """
        Send incremental data to Non-Voting Assistant API.
        
        Args:
            meeting_summary: Summary of meeting (can be recent or cumulative)
            recent_transcription: NEW transcripts since last call (formatted)
            shown_slide: NEW unique slide summaries since last call
            
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
            
            logger.info(f"📤 Sending non-voting request to Palantir")
            
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    settings.non_voting_assistant_url,
                    json=payload,
                    headers=headers
                )
            
            if response.status_code in [200, 201]:
                logger.info(f"✅ Successfully received non-voting assistant response")
                return response.json()
            else:
                logger.error(f"❌ Non-voting API returned status {response.status_code}: {response.text}")
                return None
                
        except httpx.TimeoutException:
            logger.error("❌ Non-voting API request timed out")
            return None
        except httpx.RequestError as e:
            logger.error(f"❌ Non-voting API request failed: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"❌ Unexpected error calling non-voting API: {str(e)}")
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
            db: Database session
        """
        try:
            from app.models.non_voting_assistant import NonVotingAssistantResponse
            from app.models.speaker_transcript import SpeakerTranscript
            from app.models.screenshare_capture import ScreenshareCapture
            
            logger.info(f"🎯 Starting non-voting checkpoint for meeting {meeting_id} at chunk {chunk_id}")
            
            # Get last checkpoint time
            last_response = db.query(NonVotingAssistantResponse)\
                .filter(NonVotingAssistantResponse.meeting_id == meeting_id)\
                .order_by(NonVotingAssistantResponse.created_at.desc())\
                .first()
            
            last_checkpoint_time = last_response.created_at if last_response else None
            
            if last_checkpoint_time:
                logger.info(f"📅 Last checkpoint: {last_checkpoint_time}")
            else:
                logger.info(f"📅 First checkpoint for this meeting")
            
            # 1. Get NEW transcripts
            query = db.query(SpeakerTranscript)\
                .filter(SpeakerTranscript.meeting_id == meeting_id)
            
            if last_checkpoint_time:
                query = query.filter(SpeakerTranscript.created_at > last_checkpoint_time)
            
            new_transcripts = query.order_by(SpeakerTranscript.start_time).all()
            logger.info(f"📝 Found {len(new_transcripts)} new transcripts")
            
            # Format transcripts for API
            transcript_text = "\n".join([
                f"{t.speaker_name}: {t.transcript_text}"
                for t in new_transcripts
            ])
            
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
            logger.info(f"📸 Found {len(new_screenshots)} new screenshots")
            
            # 3. Deduplicate slides
            unique_slides = self.deduplicate_slides(new_screenshots)
            
            slide_text = "\n".join([
                f"[{s.captured_at}] {s.vision_analysis}"
                for s in unique_slides
            ])
            
            # 4. Generate meeting summary (use recent transcripts for now)
            meeting_summary = transcript_text[:5000]  # Limit size
            
            # 5. Call API
            api_response = await self.send_non_voting_request(
                meeting_summary=meeting_summary,
                recent_transcription=transcript_text,
                shown_slide=slide_text
            )
            
            if not api_response:
                logger.error("❌ Non-voting API call failed")
                return
            
            # 6. Store in database
            response_value = api_response.get('value', {})
            
            db_record = NonVotingAssistantResponse(
                meeting_id=meeting_id,
                triggered_at_chunk_id=chunk_id,
                transcript_count=len(new_transcripts),
                unique_slide_count=len(unique_slides),
                screenshot_ids=[str(s.id) for s in unique_slides],
                suggested_questions=response_value.get('suggested_questions', []),
                quotes=response_value.get('quotes', []),
                engagement_points=response_value.get('engagement_points', []),
                non_voting_opinions=response_value.get('non_voting_opinions', []),
                api_response_status='completed'
            )
            
            db.add(db_record)
            db.commit()
            logger.info(f"💾 Stored non-voting response in database")
            
            # 7. Broadcast via WebSocket with screenshot URLs
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
                        "timestamp": t.start_time.isoformat(),
                        "speaker_name": t.speaker_name,
                        "transcript": t.transcript_text
                    }
                    for t in new_transcripts
                ],
                "new_slides": [
                    {
                        "screenshot_id": str(s.id),
                        "screenshot_url": f"/api/screenshots/image/{s.id}",
                        "analysis": s.vision_analysis,
                        "captured_at": s.captured_at.isoformat()
                    }
                    for s in unique_slides
                ],
                "unique_slide_count": len(unique_slides)
            }
            
            manager.broadcast_non_voting_assistant_sync(str(meeting_id), broadcast_data)
            logger.info(f"📡 Broadcast non-voting response via WebSocket")
            
            logger.info(f"✅ Non-voting checkpoint completed - Chunk {chunk_id}")
            
        except Exception as e:
            logger.error(f"❌ Non-voting checkpoint failed: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())


# Singleton instance
palantir_service = PalantirService()

