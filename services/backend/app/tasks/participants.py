"""
Participants Fetch Celery Task

Fetches live participants from the Webex Meeting Participants API
and appends new emails to the meeting record.
"""

import asyncio
import logging
from app.celery_app import celery_app

logger = logging.getLogger(__name__)


async def fetch_participants_async(meeting_uuid: str):
    """
    Fetch participants for a meeting and append new emails.
    
    Args:
        meeting_uuid: UUID of the meeting in our database
    """
    from app.core.database import SessionLocal
    from app.core.config import settings
    from app.models.meeting import Meeting
    from app.services.webex_api import WebexMeetingsAPI
    
    db = SessionLocal()
    try:
        # Get meeting from database
        meeting = db.query(Meeting).filter(Meeting.id == meeting_uuid).first()
        
        if not meeting:
            logger.warning(f"⚠️ Meeting {meeting_uuid} not found")
            return
        
        if not meeting.is_active:
            logger.info(f"ℹ️ Meeting {meeting_uuid} is not active, skipping participant fetch")
            return
        
        if not meeting.host_email:
            logger.warning(f"⚠️ Meeting {meeting_uuid} has no host_email, skipping participant fetch")
            return
        
        # Initialize Webex API client
        webex_api = WebexMeetingsAPI(
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            refresh_token=settings.webex_refresh_token,
            personal_token=settings.webex_personal_access_token
        )
        
        try:
            # Fetch participants from Webex API
            participant_emails = await webex_api.get_meeting_participants(
                meeting.webex_meeting_id,
                meeting.host_email
            )
        finally:
            await webex_api.close()
        
        if not participant_emails:
            logger.info(f"ℹ️ No participants returned from API for meeting {meeting_uuid}")
            return
        
        # Get existing emails to check for duplicates
        existing_emails = set()
        
        # Add host email
        if meeting.host_email:
            existing_emails.add(meeting.host_email.lower())
        
        # Add cohost emails
        if meeting.cohost_emails:
            existing_emails.update(e.lower() for e in meeting.cohost_emails)
        
        # Add invitee emails
        if meeting.invitees_emails:
            existing_emails.update(e.lower() for e in meeting.invitees_emails)
        
        # Add already tracked participant emails
        current_participants = meeting.participants_emails or []
        existing_emails.update(e.lower() for e in current_participants)
        
        # Filter to only new emails
        new_emails = [
            email for email in participant_emails
            if email.lower() not in existing_emails
        ]
        
        if new_emails:
            # Append new emails to participants_emails
            updated_participants = current_participants + new_emails
            meeting.participants_emails = updated_participants
            db.commit()
            
            logger.info(f"✅ Added {len(new_emails)} new participants to meeting {meeting_uuid}: {new_emails}")
        else:
            logger.info(f"ℹ️ No new participants to add for meeting {meeting_uuid}")
            
    except Exception as e:
        logger.error(f"❌ Failed to fetch participants for meeting {meeting_uuid}: {str(e)}")
        db.rollback()
    finally:
        db.close()


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def fetch_meeting_participants(self, meeting_uuid: str):
    """
    Celery task to fetch and append meeting participants.
    
    Args:
        meeting_uuid: UUID of the meeting in our database
    """
    try:
        logger.info(f"👥 [Celery] Fetching participants for meeting: {meeting_uuid}")
        
        # Run the async function
        asyncio.run(fetch_participants_async(meeting_uuid))
        
        logger.info(f"✅ [Celery] Participant fetch completed for meeting: {meeting_uuid}")
        
    except Exception as e:
        logger.error(f"❌ [Celery] Participant fetch failed for meeting {meeting_uuid}: {str(e)}")
        
        # Retry on failure
        try:
            raise self.retry(exc=e)
        except self.MaxRetriesExceededError:
            logger.error(f"❌ [Celery] Max retries exceeded for participant fetch: {meeting_uuid}")

