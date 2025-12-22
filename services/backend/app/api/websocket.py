from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json
import logging
import asyncio
import re
import redis

from app.core.database import SessionLocal
from app.core.config import settings
from app.core.auth import decode_jwt_token_raw, check_meeting_access
from app.models.meeting import Meeting

logger = logging.getLogger(__name__)

router = APIRouter()

# Store the main event loop for thread-safe broadcasting
_main_loop = None

# Redis client for pub/sub (used by Celery workers to send broadcasts)
_redis_client = None

def get_redis_client():
    """Get or create Redis client for pub/sub"""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(settings.redis_url)
            _redis_client.ping()  # Test connection
            logger.info("📡 Redis client connected for WebSocket pub/sub")
        except Exception as e:
            logger.warning(f"⚠️ Redis not available for pub/sub: {e}")
            _redis_client = None
    return _redis_client

def set_main_loop():
    """Set the main event loop (call this from startup)"""
    global _main_loop
    _main_loop = asyncio.get_event_loop()
    logger.info("📡 Main event loop stored for WebSocket broadcasts")


async def redis_subscriber():
    """
    Subscribe to Redis pub/sub channel and broadcast messages via WebSocket.
    This runs in the FastAPI process to receive broadcasts from Celery workers.
    """
    redis_client = get_redis_client()
    if not redis_client:
        logger.warning("⚠️ Redis not available - Celery broadcasts will not work")
        return
    
    try:
        pubsub = redis_client.pubsub()
        pubsub.subscribe("websocket_broadcasts")
        logger.info("📡 Subscribed to Redis websocket_broadcasts channel")
        
        while True:
            try:
                message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message["type"] == "message":
                    data = json.loads(message["data"])
                    msg_type = data.get("type")
                    meeting_id = data.get("meeting_id")
                    payload = data.get("data")
                    
                    if msg_type == "transcript":
                        await manager.broadcast_transcript(meeting_id, payload)
                    elif msg_type == "summary":
                        await manager.broadcast_summary(meeting_id, payload.get("summary", ""))
                    elif msg_type == "non_voting_assistant":
                        await manager.broadcast_non_voting_assistant(meeting_id, payload)
                    
                    logger.debug(f"📡 Received and broadcast {msg_type} from Redis for meeting {meeting_id}")
                
                # Small sleep to prevent busy loop
                await asyncio.sleep(0.01)
                
            except Exception as e:
                logger.error(f"❌ Error processing Redis message: {e}")
                await asyncio.sleep(1)
                
    except Exception as e:
        logger.error(f"❌ Redis subscriber error: {e}")
    finally:
        try:
            pubsub.unsubscribe()
            pubsub.close()
        except:
            pass


def start_redis_subscriber():
    """Start the Redis subscriber as a background task"""
    global _main_loop
    if _main_loop:
        asyncio.run_coroutine_threadsafe(redis_subscriber(), _main_loop)
        logger.info("📡 Started Redis subscriber for Celery broadcasts")


class ConnectionManager:
    """
    WebSocket connection manager for real-time updates.
    Manages connections per meeting_id for efficient broadcasting.
    """
    
    def __init__(self):
        # Dictionary mapping meeting_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
    
    def register(self, websocket: WebSocket, meeting_id: str):
        """Register a WebSocket connection for a meeting (after auth)"""
        if meeting_id not in self.active_connections:
            self.active_connections[meeting_id] = set()
        
        self.active_connections[meeting_id].add(websocket)
        logger.info(f"🔌 WebSocket registered to meeting {meeting_id} (total: {len(self.active_connections[meeting_id])})")
    
    def disconnect(self, websocket: WebSocket, meeting_id: str):
        """Unregister a WebSocket connection"""
        if meeting_id in self.active_connections:
            self.active_connections[meeting_id].discard(websocket)
            
            # Clean up empty meeting rooms
            if len(self.active_connections[meeting_id]) == 0:
                del self.active_connections[meeting_id]
                logger.info(f"🧹 Cleaned up empty meeting room: {meeting_id}")
            else:
                logger.info(f"🔌 WebSocket disconnected from meeting {meeting_id} (remaining: {len(self.active_connections[meeting_id])})")
    
    async def broadcast_to_meeting(self, meeting_id: str, message: dict):
        """
        Broadcast a message to all connections subscribed to a specific meeting.
        Removes stale connections automatically.
        """
        if meeting_id not in self.active_connections:
            logger.debug(f"No active connections for meeting {meeting_id}")
            return
        
        # Get connections for this meeting
        connections = self.active_connections[meeting_id].copy()
        stale_connections = []
        
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to connection: {str(e)}")
                stale_connections.append(connection)
        
        # Remove stale connections
        for stale in stale_connections:
            self.disconnect(stale, meeting_id)
        
        if stale_connections:
            logger.info(f"🧹 Removed {len(stale_connections)} stale connections from meeting {meeting_id}")
    
    async def broadcast_transcript(self, meeting_id: str, transcript_data: dict):
        """Broadcast a new transcript to all subscribers of a meeting"""
        message = {
            "type": "transcript",
            "data": transcript_data
        }
        await self.broadcast_to_meeting(meeting_id, message)
        logger.info(f"📤 Broadcast transcript to meeting {meeting_id}")
    
    def broadcast_transcript_sync(self, meeting_id: str, transcript_data: dict):
        """Thread-safe synchronous version of broadcast_transcript"""
        global _main_loop
        if _main_loop and _main_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.broadcast_transcript(meeting_id, transcript_data),
                _main_loop
            )
            logger.debug(f"📡 Scheduled transcript broadcast for meeting {meeting_id}")
        else:
            # Use Redis pub/sub when called from Celery worker
            self._publish_to_redis("transcript", meeting_id, transcript_data)
    
    def _publish_to_redis(self, msg_type: str, meeting_id: str, data: dict):
        """Publish message to Redis for FastAPI to pick up and broadcast"""
        redis_client = get_redis_client()
        if redis_client:
            try:
                message = json.dumps({
                    "type": msg_type,
                    "meeting_id": meeting_id,
                    "data": data
                })
                redis_client.publish("websocket_broadcasts", message)
                logger.info(f"📡 Published {msg_type} to Redis for meeting {meeting_id}")
            except Exception as e:
                logger.error(f"❌ Failed to publish to Redis: {e}")
        else:
            logger.warning(f"⚠️ Cannot broadcast {msg_type} - no Redis or main loop available")
    
    async def broadcast_summary(self, meeting_id: str, summary: str):
        """Broadcast meeting summary to all subscribers"""
        message = {
            "type": "summary",
            "data": {
                "meeting_id": meeting_id,
                "summary": summary
            }
        }
        await self.broadcast_to_meeting(meeting_id, message)
        logger.info(f"📤 Broadcast summary to meeting {meeting_id}")
    
    def broadcast_summary_sync(self, meeting_id: str, summary: str):
        """Thread-safe synchronous version of broadcast_summary"""
        global _main_loop
        if _main_loop and _main_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.broadcast_summary(meeting_id, summary),
                _main_loop
            )
            logger.debug(f"📡 Scheduled summary broadcast for meeting {meeting_id}")
        else:
            # Use Redis pub/sub when called from Celery worker
            self._publish_to_redis("summary", meeting_id, {"meeting_id": meeting_id, "summary": summary})
    
    async def broadcast_non_voting_assistant(self, meeting_id: str, response_data: dict):
        """Broadcast non-voting assistant response to all subscribers"""
        message = {
            "type": "non_voting_assistant",
            "data": response_data
        }
        await self.broadcast_to_meeting(meeting_id, message)
        logger.info(f"📤 Broadcast non-voting assistant response to meeting {meeting_id}")
    
    def broadcast_non_voting_assistant_sync(self, meeting_id: str, response_data: dict):
        """Thread-safe synchronous version of broadcast_non_voting_assistant"""
        global _main_loop
        if _main_loop and _main_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.broadcast_non_voting_assistant(meeting_id, response_data),
                _main_loop
            )
            logger.debug(f"📡 Scheduled non-voting assistant broadcast for meeting {meeting_id}")
        else:
            # Use Redis pub/sub when called from Celery worker
            self._publish_to_redis("non_voting_assistant", meeting_id, response_data)
    
    async def broadcast_status(self, meeting_id: str, is_active: bool):
        """Broadcast meeting status change to all subscribers"""
        message = {
            "type": "status",
            "data": {
                "meeting_id": meeting_id,
                "is_active": is_active
            }
        }
        await self.broadcast_to_meeting(meeting_id, message)
        logger.info(f"📤 Broadcast status change to meeting {meeting_id}: is_active={is_active}")
    
    def get_connection_count(self, meeting_id: str = None) -> int:
        """Get number of active connections (total or for specific meeting)"""
        if meeting_id:
            return len(self.active_connections.get(meeting_id, set()))
        else:
            return sum(len(conns) for conns in self.active_connections.values())


# Global connection manager instance
manager = ConnectionManager()


def resolve_meeting_from_link(link: str, db) -> Meeting:
    """
    Resolve a meeting from a meeting link.
    
    Tries:
    1. Exact match on meeting_link
    2. Personal room match (/meet/username -> /join/username)
    
    Returns the most recent meeting for the link.
    """
    # Try exact match first
    meeting = db.query(Meeting).filter(
        Meeting.meeting_link == link
    ).order_by(Meeting.created_at.desc()).first()
    
    if meeting:
        return meeting
    
    # Try personal room match
    personal_room_match = re.search(r'/meet/([^/?]+)', link)
    if personal_room_match:
        username = personal_room_match.group(1)
        logger.info(f"🔍 Trying personal room match for username")
        
        # Search for meetings with /join/{username} (how Webex API stores it)
        meeting = db.query(Meeting).filter(
            Meeting.meeting_link.ilike(f'%/join/{username}%')
        ).order_by(Meeting.created_at.desc()).first()
    
    return meeting


@router.websocket("/ws/meeting")
async def websocket_meeting_endpoint(websocket: WebSocket):
    """
    Secure WebSocket endpoint for real-time meeting updates.
    
    Connection Flow:
    1. Client connects to /ws/meeting (no sensitive data in URL)
    2. Client sends auth message within 10 seconds:
       {"type": "auth", "token": "jwt_token", "meeting_id": "uuid"}
       OR
       {"type": "auth", "token": "jwt_token", "meeting_link": "https://..."}
    3. Server validates JWT and checks meeting access
    4. On success: {"type": "auth_success", "meeting_id": "uuid", "user": {...}}
    5. Proceed with normal message handling (transcripts, summaries, status)
    
    Clients receive:
    - New transcript segments as they're created
    - Meeting summaries
    - Non-voting assistant responses
    - Meeting status changes (is_active updates)
    """
    await websocket.accept()
    meeting_id = None
    
    try:
        # Wait for auth message (10 second timeout)
        try:
            auth_data = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=10.0
            )
        except asyncio.TimeoutError:
            logger.warning("WebSocket auth timeout")
            await websocket.close(code=1008, reason="Authentication timeout")
            return
        
        # Validate auth message format
        if auth_data.get("type") != "auth":
            await websocket.close(code=1008, reason="First message must be authentication")
            return
        
        token = auth_data.get("token")
        if not token:
            await websocket.close(code=1008, reason="Missing token")
            return
        
        # Validate JWT token
        try:
            user_info = decode_jwt_token_raw(token)
        except ValueError as e:
            error_msg = str(e)
            logger.warning(f"WebSocket JWT validation failed: {error_msg}")
            await websocket.close(code=1008, reason=error_msg)
            return
        
        user_email = user_info.get("email", "")
        logger.info(f"🔐 WebSocket authenticated: {user_email}")
        
        # Resolve meeting from meeting_id or meeting_link
        db = SessionLocal()
        meeting = None
        
        try:
            if "meeting_id" in auth_data:
                # Direct UUID lookup
                import uuid
                try:
                    uuid_obj = uuid.UUID(auth_data["meeting_id"])
                    meeting = db.query(Meeting).filter(Meeting.id == uuid_obj).first()
                except ValueError:
                    await websocket.close(code=1008, reason="Invalid meeting ID format")
                    return
                    
            elif "meeting_link" in auth_data:
                # Resolve from link
                meeting = resolve_meeting_from_link(auth_data["meeting_link"], db)
            else:
                await websocket.close(code=1008, reason="Must provide meeting_id or meeting_link")
                return
            
            if not meeting:
                await websocket.close(code=1008, reason="Meeting not found")
                return
            
            # Check user access
            if not check_meeting_access(user_email, meeting):
                logger.warning(f"WebSocket access denied for {user_email} to meeting {meeting.id}")
                await websocket.close(code=1008, reason="Access denied")
                return
            
            meeting_id = str(meeting.id)
            
        finally:
            db.close()
        
        # Register connection to meeting room
        manager.register(websocket, meeting_id)
        
        # Send auth success response
        await websocket.send_json({
            "type": "auth_success",
            "meeting_id": meeting_id,
            "user": {
                "email": user_info.get("email"),
                "name": user_info.get("name")
            }
        })
        
        logger.info(f"✅ WebSocket connected to meeting {meeting_id} for user {user_email}")
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await websocket.receive_text()
                
                # Handle ping/pong for keepalive
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected gracefully for meeting {meeting_id}")
                break
            except Exception as e:
                logger.error(f"Error in WebSocket loop for meeting {meeting_id}: {str(e)}")
                break
                
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected during auth")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        try:
            await websocket.close(code=1011, reason="Internal error")
        except:
            pass
    finally:
        if meeting_id:
            manager.disconnect(websocket, meeting_id)


@router.get("/ws/stats")
async def websocket_stats():
    """
    Get WebSocket connection statistics (for debugging/monitoring).
    Returns total connections and per-meeting breakdown.
    """
    stats = {
        "total_connections": manager.get_connection_count(),
        "active_meetings": len(manager.active_connections),
        "meetings": {
            meeting_id: len(connections) 
            for meeting_id, connections in manager.active_connections.items()
        }
    }
    return stats
