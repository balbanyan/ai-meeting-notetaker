from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ============================================================================
# JOIN ENDPOINT SCHEMAS
# ============================================================================

class RegisterAndJoinRequest(BaseModel):
    meeting_id: str  # Webex meeting ID from SDK
    enable_non_voting: Optional[bool] = None  # Enable non-voting assistant (overrides .env if provided)
    non_voting_call_frequency: Optional[int] = None  # Chunks between calls (overrides .env if provided)
    classification: Optional[str] = "shared"  # Access classification: "private" (host only) or "shared" (all participants)


class RegisterAndJoinWithLinkRequest(BaseModel):
    meeting_link: str  # Full Webex meeting URL
    enable_non_voting: Optional[bool] = None  # Enable non-voting assistant (overrides .env if provided)
    non_voting_call_frequency: Optional[int] = None  # Chunks between calls (overrides .env if provided)
    classification: Optional[str] = "shared"  # Access classification: "private" (host only) or "shared" (all participants)


class RegisterAndJoinResponse(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    status: str
    message: str


class RegisterAndJoinByLinkResponse(BaseModel):
    meeting_uuid: str
    status: str


# ============================================================================
# STATUS ENDPOINT SCHEMAS
# ============================================================================

class TestJoinRequest(BaseModel):
    meeting_url: str


class TestJoinResponse(BaseModel):
    meeting_uuid: str
    meeting_url: str
    status: str
    message: str


class UpdateMeetingStatusRequest(BaseModel):
    is_active: bool
    actual_join_time: Optional[str] = None
    actual_leave_time: Optional[str] = None


# ============================================================================
# FRONTEND API SCHEMAS
# ============================================================================

class MeetingListItem(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    original_webex_meeting_id: Optional[str]
    meeting_number: Optional[str]
    meeting_title: Optional[str]
    host_email: Optional[str]
    invitees_emails: Optional[List[str]]
    cohost_emails: Optional[List[str]]
    participants_emails: Optional[List[str]]  # Actual participants who joined the meeting
    scheduled_start_time: Optional[datetime]
    scheduled_end_time: Optional[datetime]
    actual_join_time: Optional[datetime]
    actual_leave_time: Optional[datetime]
    meeting_type: Optional[str]
    scheduled_type: Optional[str]
    meeting_summary: Optional[str]
    is_active: bool  # Include is_active status for frontend
    
    class Config:
        from_attributes = True


class MeetingsListResponse(BaseModel):
    meetings: List[MeetingListItem]
    total_count: int


class MeetingDetailsTranscript(BaseModel):
    id: str  # Transcript ID for duplicate detection
    speaker_name: Optional[str]
    transcript_text: str
    start_time: datetime
    end_time: datetime
    
    class Config:
        from_attributes = True


class MeetingStatusResponse(BaseModel):
    """Simple response for meeting status check by Webex meeting ID"""
    is_active: bool


class MeetingDetailsResponse(BaseModel):
    meeting_uuid: str
    webex_meeting_id: str
    original_webex_meeting_id: Optional[str]
    meeting_number: Optional[str]
    meeting_title: Optional[str]
    meeting_link: str
    host_email: Optional[str]
    invitees_emails: Optional[List[str]]
    cohost_emails: Optional[List[str]]
    participants_emails: Optional[List[str]]  # Actual participants who joined the meeting
    scheduled_start_time: Optional[datetime]
    scheduled_end_time: Optional[datetime]
    actual_join_time: Optional[datetime]
    actual_leave_time: Optional[datetime]
    meeting_type: Optional[str]
    scheduled_type: Optional[str]
    meeting_summary: Optional[str]
    is_active: bool  # Include is_active for live meeting detection
    transcripts: List[MeetingDetailsTranscript]
    
    class Config:
        from_attributes = True

