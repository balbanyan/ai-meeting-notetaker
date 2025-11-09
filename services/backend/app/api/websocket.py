from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json
import logging
import asyncio

logger = logging.getLogger(__name__)

router = APIRouter()

# Store the main event loop for thread-safe broadcasting
_main_loop = None

def set_main_loop():
    """Set the main event loop (call this from startup)"""
    global _main_loop
    _main_loop = asyncio.get_event_loop()
    logger.info("📡 Main event loop stored for WebSocket broadcasts")


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
            logger.warning(f"⚠️ Cannot broadcast - no main loop available")
    
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
            logger.warning(f"⚠️ Cannot broadcast summary - no main loop available")
    
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

