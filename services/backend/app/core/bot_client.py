"""
Bot Runner HTTP Client

This module handles communication with the bot-runner service via HTTP API.
"""

import httpx
import asyncio
from typing import Optional, Dict, Any
from pydantic import BaseModel
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


class BotJoinRequest(BaseModel):
    meetingUrl: str
    title: Optional[str] = None
    hostEmail: Optional[str] = None


class BotJoinResponse(BaseModel):
    success: bool
    message: str
    meeting: Optional[Dict[str, Any]] = None


class BotLeaveResponse(BaseModel):
    success: bool
    message: str


class BotStatusResponse(BaseModel):
    server: Dict[str, Any]
    bot: Dict[str, Any]
    config: Dict[str, Any]


class BotRunnerClient:
    """HTTP client for communicating with the bot-runner service"""
    
    def __init__(self):
        self.base_url = settings.BOT_RUNNER_URL
        self.auth_headers = {
            "Authorization": f"Bearer {settings.BOT_SERVICE_TOKEN}",
            "Content-Type": "application/json"
        }
        self.timeout = httpx.Timeout(30.0)  # 30 second timeout
    
    async def _make_request(
        self, 
        method: str, 
        endpoint: str, 
        data: Optional[Dict[str, Any]] = None,
        require_auth: bool = True
    ) -> Dict[str, Any]:
        """Make an HTTP request to the bot-runner API"""
        url = f"{self.base_url}{endpoint}"
        headers = self.auth_headers if require_auth else {"Content-Type": "application/json"}
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                logger.info(f"Making {method} request to {url}")
                
                if method.upper() == "GET":
                    response = await client.get(url, headers=headers)
                elif method.upper() == "POST":
                    response = await client.post(url, headers=headers, json=data)
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")
                
                # Log response details
                logger.info(f"Bot-runner response: {response.status_code}")
                
                # Handle different response statuses
                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Bot-runner success: {result.get('message', 'Success')}")
                    return result
                elif response.status_code == 401:
                    logger.error("Bot-runner authentication failed - invalid token")
                    raise BotRunnerAuthError("Invalid authentication token")
                elif response.status_code == 400:
                    error_data = response.json()
                    error_msg = error_data.get('message', 'Bad request')
                    logger.error(f"Bot-runner bad request: {error_msg}")
                    raise BotRunnerBadRequestError(error_msg)
                elif response.status_code == 503:
                    error_data = response.json()
                    error_msg = error_data.get('message', 'Service unavailable')
                    logger.error(f"Bot-runner service unavailable: {error_msg}")
                    raise BotRunnerUnavailableError(error_msg)
                else:
                    error_data = response.json() if response.content else {}
                    error_msg = error_data.get('message', f'HTTP {response.status_code}')
                    logger.error(f"Bot-runner request failed: {error_msg}")
                    raise BotRunnerError(f"Request failed: {error_msg}")
                    
        except httpx.TimeoutException:
            logger.error("Bot-runner request timed out")
            raise BotRunnerTimeoutError("Request to bot-runner timed out")
        except httpx.ConnectError:
            logger.error("Failed to connect to bot-runner")
            raise BotRunnerConnectionError("Failed to connect to bot-runner service")
        except Exception as e:
            if isinstance(e, BotRunnerError):
                raise
            logger.error(f"Unexpected error communicating with bot-runner: {e}")
            raise BotRunnerError(f"Unexpected error: {str(e)}")
    
    async def get_status(self) -> BotStatusResponse:
        """Get the current status of the bot-runner"""
        try:
            data = await self._make_request("GET", "/api/status", require_auth=False)
            return BotStatusResponse(**data)
        except Exception as e:
            logger.error(f"Failed to get bot status: {e}")
            raise
    
    async def join_meeting(
        self, 
        meeting_url: str, 
        title: Optional[str] = None, 
        host_email: Optional[str] = None
    ) -> BotJoinResponse:
        """Request the bot to join a meeting"""
        try:
            request_data = BotJoinRequest(
                meetingUrl=meeting_url,
                title=title,
                hostEmail=host_email
            )
            
            logger.info(f"Requesting bot to join meeting: {meeting_url}")
            data = await self._make_request(
                "POST", 
                "/api/join-meeting", 
                data=request_data.dict()
            )
            
            return BotJoinResponse(**data)
            
        except Exception as e:
            logger.error(f"Failed to join meeting: {e}")
            raise
    
    async def leave_meeting(self) -> BotLeaveResponse:
        """Request the bot to leave the current meeting"""
        try:
            logger.info("Requesting bot to leave meeting")
            data = await self._make_request("POST", "/api/leave-meeting", data={})
            return BotLeaveResponse(**data)
            
        except Exception as e:
            logger.error(f"Failed to leave meeting: {e}")
            raise
    
    async def health_check(self) -> bool:
        """Check if the bot-runner service is healthy and reachable"""
        try:
            status = await self.get_status()
            return status.server.get("isRunning", False)
        except Exception as e:
            logger.warning(f"Bot-runner health check failed: {e}")
            return False


# Custom exceptions for bot-runner communication
class BotRunnerError(Exception):
    """Base exception for bot-runner communication errors"""
    pass


class BotRunnerConnectionError(BotRunnerError):
    """Failed to connect to bot-runner service"""
    pass


class BotRunnerTimeoutError(BotRunnerError):
    """Request to bot-runner timed out"""
    pass


class BotRunnerAuthError(BotRunnerError):
    """Authentication with bot-runner failed"""
    pass


class BotRunnerBadRequestError(BotRunnerError):
    """Bad request sent to bot-runner"""
    pass


class BotRunnerUnavailableError(BotRunnerError):
    """Bot-runner service is unavailable"""
    pass


# Global client instance
_bot_client: Optional[BotRunnerClient] = None


def get_bot_client() -> BotRunnerClient:
    """Get the global bot-runner client instance"""
    global _bot_client
    if _bot_client is None:
        _bot_client = BotRunnerClient()
    return _bot_client
