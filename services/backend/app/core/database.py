import time
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import text
from app.core.config import settings

engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_pgvector():
    """Ensure pgvector extension is available with retry logic"""
    max_retries = 5
    for attempt in range(max_retries):
        try:
            with engine.connect() as connection:
                # Check if pgvector extension exists
                result = connection.execute(
                    text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
                )
                if result.fetchone() is None:
                    print(f"Attempt {attempt + 1}: pgvector extension not found, creating...")
                    connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                    connection.commit()
                
                # Verify extension is working
                connection.execute(text("SELECT '[1,2,3]'::vector"))
                print("✅ pgvector extension is working")
                return True
                
        except Exception as e:
            print(f"Attempt {attempt + 1}: Database connection failed: {e}")
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt
                print(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
            else:
                print("❌ Failed to connect to database after all retries")
                raise
    
    return False
