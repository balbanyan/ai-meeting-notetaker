from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from typing import Optional
from uuid import UUID
import asyncio
import json
import time

from app.core.queue import enqueue_job

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.audio_buffers: dict[str, list] = {}
        self.chunk_counters: dict[str, int] = {}

    async def connect(self, websocket: WebSocket, meeting_id: str):
        await websocket.accept()
        self.active_connections[meeting_id] = websocket
        self.audio_buffers[meeting_id] = []
        self.chunk_counters[meeting_id] = 0

    def disconnect(self, meeting_id: str):
        if meeting_id in self.active_connections:
            del self.active_connections[meeting_id]
        if meeting_id in self.audio_buffers:
            del self.audio_buffers[meeting_id]
        if meeting_id in self.chunk_counters:
            del self.chunk_counters[meeting_id]

    async def send_message(self, message: dict, meeting_id: str):
        if meeting_id in self.active_connections:
            websocket = self.active_connections[meeting_id]
            await websocket.send_text(json.dumps(message))

    def process_audio_chunk(self, meeting_id: str, audio_data: bytes) -> bool:
        """Process incoming audio chunk and enqueue for STT when ready"""
        if meeting_id not in self.audio_buffers:
            return False
        
        # Add to buffer
        self.audio_buffers[meeting_id].append(audio_data)
        
        # Calculate total buffer size
        total_size = sum(len(chunk) for chunk in self.audio_buffers[meeting_id])
        
        # Process when we have ~8 seconds of audio (assuming 16kHz mono = ~32KB/sec)
        target_size = 8 * 32000  # ~8 seconds of audio
        
        if total_size >= target_size:
            # Combine audio chunks
            combined_audio = b''.join(self.audio_buffers[meeting_id])
            
            # Calculate timing
            chunk_num = self.chunk_counters[meeting_id]
            start_time_ms = chunk_num * 8000  # 8 second chunks
            end_time_ms = start_time_ms + 8000
            
            # Enqueue STT job
            from app.workers.stt_worker import process_audio_chunk
            job = enqueue_job(
                'stt',
                process_audio_chunk,
                meeting_id,
                combined_audio,
                start_time_ms,
                end_time_ms,
                {"chunk_number": chunk_num}
            )
            
            # Clear buffer and increment counter
            self.audio_buffers[meeting_id] = []
            self.chunk_counters[meeting_id] += 1
            
            return True
        
        return False


manager = ConnectionManager()


@router.websocket("/ingest/audio")
async def websocket_audio_ingest(
    websocket: WebSocket,
    meetingId: str = Query(...),
    chunk_size: Optional[int] = Query(8000)  # Default 8KB chunks
):
    """WebSocket endpoint for real-time audio ingestion"""
    await manager.connect(websocket, meetingId)
    
    try:
        while True:
            # Receive audio data (binary)
            audio_data = await websocket.receive_bytes()
            
            # Process audio chunk and potentially enqueue STT job
            job_enqueued = manager.process_audio_chunk(meetingId, audio_data)
            
            # Send acknowledgment back to client
            await manager.send_message({
                "type": "ack",
                "chunk_size": len(audio_data),
                "meeting_id": meetingId,
                "job_enqueued": job_enqueued,
                "timestamp": time.time()
            }, meetingId)
            
    except WebSocketDisconnect:
        manager.disconnect(meetingId)
        print(f"WebSocket disconnected for meeting {meetingId}")
    except Exception as e:
        print(f"WebSocket error for meeting {meetingId}: {e}")
        manager.disconnect(meetingId)


@router.post("/ingest/transcript")
async def ingest_transcript_segment():
    """HTTP endpoint for transcript segment ingestion (from STT worker)"""
    # TODO: Implement transcript segment storage
    # This will be called by the STT worker to store transcript segments
    return {"status": "not_implemented"}


@router.get("/ingest/status/{meeting_id}")
async def get_ingestion_status(meeting_id: UUID):
    """Get current ingestion status for a meeting"""
    # TODO: Implement status checking
    # Check if audio is being ingested, STT is processing, etc.
    is_connected = str(meeting_id) in manager.active_connections
    
    return {
        "meeting_id": meeting_id,
        "audio_connected": is_connected,
        "stt_queue_size": 0,  # TODO: Get from Redis/RQ
        "last_activity": None  # TODO: Get from database
    }
