from fastapi import APIRouter
from datetime import datetime
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    """
    Basic health check endpoint for Cloud Run / load balancers.
    
    Responds immediately without database check to ensure fast health checks.
    """
    return {
        "status": "healthy",
        "version": "2.0-mvp"
    }


@router.get("/health/detailed")
async def detailed_health_check():
    """
    Detailed health check with database pool statistics.
    
    Use this for monitoring dashboards, not for load balancer health checks.
    """
    from app.core.database import engine
    
    # Get database pool statistics
    pool = engine.pool
    pool_status = {
        "pool_size": pool.size(),
        "checked_out": pool.checkedout(),
        "checked_in": pool.checkedin(),
        "overflow": pool.overflow(),
        "invalid": pool.invalidatedcount() if hasattr(pool, 'invalidatedcount') else 0
    }
    
    # Calculate utilization
    total_connections = pool_status["checked_out"] + pool_status["checked_in"]
    max_connections = pool.size() + pool._max_overflow
    utilization_percent = (pool_status["checked_out"] / max_connections * 100) if max_connections > 0 else 0
    
    # Check Redis connectivity
    redis_status = "unknown"
    try:
        from app.api.websocket import get_redis_client
        redis_client = get_redis_client()
        if redis_client and redis_client.ping():
            redis_status = "connected"
        else:
            redis_status = "disconnected"
    except Exception as e:
        redis_status = f"error: {str(e)}"
    
    # Check Celery status
    celery_status = "unknown"
    try:
        from app.celery_app import celery_app
        inspect = celery_app.control.inspect()
        active_workers = inspect.active()
        if active_workers:
            celery_status = f"connected ({len(active_workers)} workers)"
        else:
            celery_status = "no workers"
    except Exception as e:
        celery_status = f"error: {str(e)}"
    
    return {
        "status": "healthy",
        "version": "2.0-mvp",
        "timestamp": datetime.utcnow().isoformat(),
        "database": {
            "status": "connected",
            "pool": pool_status,
            "max_connections": max_connections,
            "utilization_percent": round(utilization_percent, 1)
        },
        "redis": {
            "status": redis_status
        },
        "celery": {
            "status": celery_status
        }
    }


@router.get("/metrics")
async def prometheus_metrics():
    """
    Prometheus-style metrics endpoint for monitoring.
    
    Returns metrics in a format compatible with Prometheus scraping.
    """
    from app.core.database import engine
    from app.api.websocket import manager
    
    # Database pool metrics
    pool = engine.pool
    max_connections = pool.size() + pool._max_overflow
    
    # WebSocket metrics
    ws_connections = manager.get_connection_count()
    ws_meetings = len(manager.active_connections)
    
    # Build Prometheus-style output
    metrics = []
    
    # Database metrics
    metrics.append(f"# HELP db_pool_size Base number of connections in pool")
    metrics.append(f"# TYPE db_pool_size gauge")
    metrics.append(f"db_pool_size {pool.size()}")
    
    metrics.append(f"# HELP db_pool_checked_out Connections currently in use")
    metrics.append(f"# TYPE db_pool_checked_out gauge")
    metrics.append(f"db_pool_checked_out {pool.checkedout()}")
    
    metrics.append(f"# HELP db_pool_overflow Current overflow connections")
    metrics.append(f"# TYPE db_pool_overflow gauge")
    metrics.append(f"db_pool_overflow {pool.overflow()}")
    
    metrics.append(f"# HELP db_pool_max_connections Maximum possible connections")
    metrics.append(f"# TYPE db_pool_max_connections gauge")
    metrics.append(f"db_pool_max_connections {max_connections}")
    
    # WebSocket metrics
    metrics.append(f"# HELP websocket_connections_total Total WebSocket connections")
    metrics.append(f"# TYPE websocket_connections_total gauge")
    metrics.append(f"websocket_connections_total {ws_connections}")
    
    metrics.append(f"# HELP websocket_active_meetings Meetings with active WebSocket subscribers")
    metrics.append(f"# TYPE websocket_active_meetings gauge")
    metrics.append(f"websocket_active_meetings {ws_meetings}")
    
    return "\n".join(metrics)
