from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker"
    bot_service_token: str = "dev-bot-token-12345"
    bot_runner_url: str = "http://localhost:3001"
    
    # Webex API Settings (Service App with refresh token)
    webex_client_id: str = ""
    webex_client_secret: str = ""
    webex_refresh_token: str = ""  # Service App refresh token (90-day validity)
    webex_personal_access_token: str = ""  # Personal access token (for testing, overrides OAuth flow)
    
    # Groq API Settings (used for both Whisper transcription and LLM processing)
    groq_api_key: str = ""
    whisper_model: str = "whisper-large-v3"
    groq_api_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "openai/gpt-oss-120b"  # LLM model for meeting summaries
    
    # Screenshot and Vision Settings
    enable_screenshots: bool = False
    vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    
    # External API Authentication
    external_api_key: str = ""
    
    # Palantir API Settings
    palantir_token: str = ""
    live_demo_url: str = ""
    send_palantir: bool = False
    
    # Non-Voting Assistant API Settings
    enable_non_voting: bool = False
    non_voting_assistant_url: str = ""
    non_voting_call_frequency: int = 20  # Call every N chunks
    
    # Bot Settings
    bot_max_duration_minutes: int = 180  # Max bot duration in meeting (3 hours default)
    
    # Redis Settings (for Celery task queue)
    redis_url: str = "redis://localhost:6379/0"
    
    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore bot-runner specific env vars


settings = Settings()
