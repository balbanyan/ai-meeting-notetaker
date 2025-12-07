from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from typing import Dict, Set
from sqlalchemy.orm import Session
import json
import logging
import asyncio
import redis

from app.core.database import get_db
from app.core.config import settings
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
    
    async def connect(self, websocket: WebSocket, meeting_id: str):
        """Accept and register a new WebSocket connection for a meeting"""
        await websocket.accept()
        
        if meeting_id not in self.active_connections:
            self.active_connections[meeting_id] = set()
        
        self.active_connections[meeting_id].add(websocket)
        logger.info(f"🔌 WebSocket connected to meeting {meeting_id} (total: {len(self.active_connections[meeting_id])})")
    
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


@router.websocket("/ws/meeting/{meeting_id}")
async def websocket_meeting_endpoint(websocket: WebSocket, meeting_id: str):
    """
    WebSocket endpoint for real-time meeting updates.
    
    Clients connect to this endpoint to receive:
    - New transcript segments as they're created
    - Meeting status changes (is_active updates)
    
    URL: ws://localhost:8080/ws/meeting/{meeting_id}
    """
    await manager.connect(websocket, meeting_id)
    
    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connected",
            "data": {
                "meeting_id": meeting_id,
                "message": "Connected to meeting updates"
            }
        })
        
        # Keep connection alive and handle incoming messages (if any)
        while True:
            try:
                # Wait for any messages from client (heartbeat/ping)
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
                
    except Exception as e:
        logger.error(f"WebSocket error for meeting {meeting_id}: {str(e)}")
    finally:
        manager.disconnect(websocket, meeting_id)


@router.websocket("/ws/meeting-by-link")
async def websocket_meeting_by_link_endpoint(websocket: WebSocket, link: str = Query(...)):
    """
    WebSocket endpoint that accepts a meeting URL and automatically finds the latest meeting UUID.
    
    Since meeting URLs can have multiple instances (recurring meetings), this endpoint
    retrieves the most recent meeting for the provided URL.
    
    Supports both exact matches and personal room links (e.g., /meet/username).
    
    URL: ws://localhost:8080/ws/meeting-by-link?link={meeting_url}
    """
    # Accept the connection first to send error messages if needed
    await websocket.accept()
    
    try:
        # Get database session - we need to do this manually since Depends doesn't work in WebSocket
        from app.core.database import SessionLocal
        import re
        db = SessionLocal()
        
        try:
            # Try exact match first
            meeting = db.query(Meeting).filter(
                Meeting.meeting_link == link
            ).order_by(Meeting.created_at.desc()).first()
            
            # If no exact match, try matching personal room links
            # User inputs: https://domain.webex.com/meet/username
            # Stored as: https://domain.webex.com/join/username (Webex API format)
            if not meeting:
                personal_room_match = re.search(r'/meet/([^/?]+)', link)
                if personal_room_match:
                    username = personal_room_match.group(1)
                    logger.info(f"🔍 Trying personal room match")
                    
                    # Search for meetings with /join/{username} (how Webex API stores it)
                    meeting = db.query(Meeting).filter(
                        Meeting.meeting_link.ilike(f'%/join/{username}%')
            ).order_by(Meeting.created_at.desc()).first()
            
            if not meeting:
                await websocket.send_json({
                    "type": "error",
                    "data": {
                        "message": "No meeting found with the provided link"
                    }
                })
                await websocket.close()
                return
            
            meeting_id = str(meeting.id)
            logger.info(f"🔗 WebSocket connected via link - resolved to meeting UUID")
            
        finally:
            db.close()
        
        # Register this connection to the meeting room
        if meeting_id not in manager.active_connections:
            manager.active_connections[meeting_id] = set()
        manager.active_connections[meeting_id].add(websocket)
        logger.info(f"🔌 WebSocket connected to meeting via link (total: {len(manager.active_connections[meeting_id])})")
        
        # Send initial connection confirmation with the resolved meeting_id
        await websocket.send_json({
            "type": "connected",
            "data": {
                "meeting_id": meeting_id,
                "message": "Connected to meeting updates (resolved from link)"
            }
        })
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await websocket.receive_text()
                
                # Handle ping/pong for keepalive
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected gracefully for meeting (via link)")
                break
            except Exception as e:
                logger.error(f"Error in WebSocket loop for meeting (via link): {str(e)}")
                break
                
    except Exception as e:
        logger.error(f"WebSocket error for meeting by link: {str(e)}")
        try:
            await websocket.send_json({
                "type": "error",
                "data": {
                    "message": f"Connection error: {str(e)}"
                }
            })
        except:
            pass
    finally:
        if 'meeting_id' in locals():
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

