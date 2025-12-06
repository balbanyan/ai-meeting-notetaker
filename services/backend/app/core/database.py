from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from app.core.config import settings

# Create database engine with connection pooling for high concurrency
# Pool configuration for 100+ concurrent meetings:
# - pool_size: Base connections always open (20)
# - max_overflow: Additional connections when pool exhausted (80)
# - Total capacity: 100 connections
# - pool_timeout: Wait 30s for available connection before timeout
# - pool_recycle: Recycle connections every hour to prevent stale connections
# - pool_pre_ping: Verify connection health before checkout
engine = create_engine(
    settings.database_url,
    poolclass=QueuePool,
    pool_size=20,              # Base connections
    max_overflow=80,           # Burst capacity (total: 100)
    pool_timeout=30,           # Wait 30s for connection
    pool_recycle=3600,         # Recycle connections every hour
    pool_pre_ping=True         # Verify connection health
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create base class for models
Base = declarative_base()


def get_db():
    """Database dependency for FastAPI"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """
    Create all tables (handles concurrent creation gracefully)
    
    This function is cloud-native and handles race conditions that occur when
    multiple container instances start simultaneously (e.g., during Cloud Run deployment).
    It's safe to call multiple times - if tables exist, they're skipped.
    """
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        print("✅ Database tables created/verified")
    except Exception as e:
        error_msg = str(e).lower()
        # Ignore "already exists" errors from concurrent startups
        # This happens when multiple Cloud Run instances start simultaneously
        if "already exists" in error_msg or "duplicate key" in error_msg:
            print(f"⚠️  Database objects already exist (concurrent startup or restart) - continuing...")
        else:
            # Re-raise other errors (connection issues, permissions, etc.)
            print(f"❌ Database error: {str(e)}")
            raise


def reset_database():
    """
    Drop and recreate all tables - USE WITH CAUTION!
    This will delete all data. Only use for development/schema changes.
    
    Handles concurrent execution gracefully when multiple Cloud Run instances
    start simultaneously.
    """
    try:
        print("⚠️  Dropping all tables...")
        Base.metadata.drop_all(bind=engine)
        print("✅ All tables dropped")
    except Exception as e:
        print(f"⚠️  Error dropping tables (they may not exist): {str(e)}")
        print("   Continuing to create tables...")
    
    try:
        print("📦 Creating tables with new schema...")
        Base.metadata.create_all(bind=engine, checkfirst=True)
        print("✅ Tables created")
    except Exception as e:
        error_msg = str(e).lower()
        # Ignore "already exists" errors from concurrent startups
        # This happens when multiple Cloud Run instances reset simultaneously
        if "already exists" in error_msg or "duplicate key" in error_msg:
            print(f"⚠️  Database objects already exist (another instance created them) - continuing...")
        else:
            # Re-raise other errors (connection issues, permissions, etc.)
            print(f"❌ Error creating tables: {str(e)}")
            raise
