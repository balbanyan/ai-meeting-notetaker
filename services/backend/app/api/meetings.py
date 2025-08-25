from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import uuid
import httpx
import asyncio
from app.core.config import settings

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
    """Trigger bot to join a meeting via headless bot-runner"""
    try:
        print(f"🚀 JOIN REQUEST - Meeting URL: {request.meeting_url}")
        print(f"   Host Name: {request.host_name}")
        
        # Call the headless bot-runner API
        bot_runner_url = f"{settings.bot_runner_url}/join"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                bot_runner_url,
                json={"meetingUrl": request.meeting_url},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                bot_response = response.json()
                
                if bot_response.get("success"):
                    meeting_id = bot_response.get("meetingId", request.meeting_url)
                    
                    print(f"✅ Bot successfully joined meeting: {meeting_id}")
                    
                    return JoinMeetingResponse(
                        meeting_id=meeting_id,
                        status="joined",
                        message="Bot successfully joined the meeting"
                    )
                else:
                    error_msg = bot_response.get("error", "Unknown error from bot-runner")
                    print(f"❌ Bot failed to join meeting: {error_msg}")
                    raise HTTPException(status_code=500, detail=f"Bot failed to join: {error_msg}")
            else:
                print(f"❌ Bot-runner API error: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=500, 
                    detail=f"Bot-runner API error: {response.status_code}"
                )
        
    except httpx.TimeoutException:
        print("❌ Bot-runner API timeout")
        raise HTTPException(status_code=504, detail="Bot-runner API timeout")
    except httpx.ConnectError:
        print("❌ Bot-runner API connection failed - is headless bot running?")
        raise HTTPException(status_code=503, detail="Bot-runner service unavailable")
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to join meeting: {str(e)}")
