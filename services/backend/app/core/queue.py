import redis
from rq import Queue, Worker
from app.core.config import settings

# Redis connection
redis_conn = redis.from_url(settings.REDIS_URL)

# RQ Queues
stt_queue = Queue('stt', connection=redis_conn)
summary_queue = Queue('summary', connection=redis_conn) 
embedding_queue = Queue('embedding', connection=redis_conn)
default_queue = Queue('default', connection=redis_conn)

def get_redis_connection():
    """Get Redis connection for job workers"""
    return redis_conn

def get_queue(queue_name: str = 'default'):
    """Get RQ queue by name"""
    queues = {
        'stt': stt_queue,
        'summary': summary_queue,
        'embedding': embedding_queue,
        'default': default_queue
    }
    return queues.get(queue_name, default_queue)

def enqueue_job(queue_name: str, func, *args, **kwargs):
    """Enqueue a job to the specified queue"""
    queue = get_queue(queue_name)
    return queue.enqueue(func, *args, **kwargs)
