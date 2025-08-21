from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid

router = APIRouter()


class JoinMeetingRequest(BaseModel):
    meeting_url: str
    host_name: str = None


class JoinMeetingResponse(BaseModel):
    meeting_id: str
    status: str
    message: str


@router.post("/meetings/join", response_model=JoinMeetingResponse)
async def join_meeting(request: JoinMeetingRequest):
    """Trigger bot to join a meeting"""
    try:
        # Generate UUID for this meeting
        meeting_id = str(uuid.uuid4())
        
        # For MVP: Just return success and meeting_id
        # In real implementation, this would call the bot-runner
        print(f"🚀 JOIN REQUEST - Meeting ID: {meeting_id}")
        print(f"   Meeting URL: {request.meeting_url}")
        print(f"   Host Name: {request.host_name}")
        
        return JoinMeetingResponse(
            meeting_id=meeting_id,
            status="requested",
            message=f"Bot join requested for meeting {meeting_id}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to join meeting: {str(e)}")
