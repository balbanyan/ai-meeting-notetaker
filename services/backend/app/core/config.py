from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    
    # MinIO/S3
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET_NAME: str = "ai-notetaker"
    S3_ARTIFACTS_BUCKET: str = "artifacts"
    
    # API
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "AI Meeting Notetaker"
    
    # Auth
    BOT_SERVICE_TOKEN: str = "your-bot-service-token-here"
    
    # AI Services
    GROQ_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    
    # Whisper Configuration
    WHISPER_MODEL: str = "whisper-large-v3-turbo"
    WHISPER_LANGUAGE: str = "auto"
    
    # LLM Configuration
    LLM_PROVIDER: str = "openai"
    LLM_MODEL: str = "gpt-4o-mini"
    
    # Job Queue Configuration
    REDIS_QUEUE_NAME: str = "ai-notetaker-jobs"
    WORKER_CONCURRENCY: int = 2
    
    # Bot Runner Configuration
    BOT_RUNNER_URL: str = "http://127.0.0.1:3001"
    
    class Config:
        env_file = ".env"


settings = Settings()
