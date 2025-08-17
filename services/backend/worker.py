#!/usr/bin/env python3
"""
RQ Worker startup script for AI Meeting Notetaker
Starts workers for STT, summary, and embedding processing
"""

import sys
import os
from rq import Worker, Queue
from rq.job import Job

# Add the app directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.queue import get_redis_connection
from app.core.config import settings

# Import worker functions to ensure they're available
from app.workers.stt_worker import process_audio_chunk
from app.workers.summary_worker import generate_meeting_summary, generate_all_summary_types
from app.workers.embedding_worker import generate_embeddings_for_text, generate_rag_response


def start_worker(queue_names=None, burst=False):
    """Start RQ worker for specified queues"""
    if queue_names is None:
        queue_names = ['stt', 'summary', 'embedding', 'default']
    
    # Create Redis connection
    redis_conn = get_redis_connection()
    
    # Create queues
    queues = [Queue(name, connection=redis_conn) for name in queue_names]
    
    print(f"🚀 Starting worker for queues: {queue_names}")
    print(f"📡 Redis URL: {settings.REDIS_URL}")
    print(f"🔄 Concurrency: {getattr(settings, 'WORKER_CONCURRENCY', 1)}")
    
    # Start worker
    worker = Worker(
        queues,
        connection=redis_conn,
        name=f"ai-notetaker-worker-{os.getpid()}"
    )
    
    if burst:
        print("⚡ Running in burst mode (will exit when no jobs)")
        worker.work(burst=True)
    else:
        print("🔁 Running in continuous mode")
        worker.work()


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Start AI Meeting Notetaker worker')
    parser.add_argument(
        '--queues', 
        nargs='+', 
        default=['stt', 'summary', 'embedding', 'default'],
        help='Queue names to process (default: all queues)'
    )
    parser.add_argument(
        '--burst',
        action='store_true',
        help='Run in burst mode (exit when no jobs)'
    )
    
    args = parser.parse_args()
    
    try:
        start_worker(args.queues, args.burst)
    except KeyboardInterrupt:
        print("\n👋 Worker stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Worker error: {e}")
        sys.exit(1)
