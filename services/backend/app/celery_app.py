"""
Celery Application Configuration

Task queue for background processing with Redis broker.
Provides persistent, reliable task execution with automatic retries.
"""

from celery import Celery
from app.core.config import settings

# Create Celery application
celery_app = Celery(
    "ai_notetaker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.tasks.transcription",
        "app.tasks.vision",
        "app.tasks.llm",
        "app.tasks.non_voting"
    ]
)

# Celery configuration
celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    
    # Task behavior
    task_track_started=True,
    task_acks_late=True,  # Re-queue task if worker crashes mid-execution
    
    # Result backend
    result_expires=3600,  # Results expire after 1 hour
    
    # Worker settings
    worker_prefetch_multiplier=1,  # Fetch one task at a time (better for long tasks)
    
    # Timezone
    timezone="UTC",
    enable_utc=True,
)

