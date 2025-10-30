from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Create database engine
engine = create_engine(settings.database_url)

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
        Base.metadata.create_all(bind=engine)
        print("✅ Tables created")
    except Exception as e:
        print(f"❌ Error creating tables: {str(e)}")
        raise
