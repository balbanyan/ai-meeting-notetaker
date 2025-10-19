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
    
    # Whisper Transcription Settings
    whisper_groq_api: str = ""
    whisper_model: str = "whisper-large-v3"
    groq_api_base_url: str = "https://api.groq.com/openai/v1"
    
    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore bot-runner specific env vars


settings = Settings()
