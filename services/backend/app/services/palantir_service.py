import httpx
import logging
from datetime import datetime
from typing import Optional
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


# Singleton instance
palantir_service = PalantirService()

