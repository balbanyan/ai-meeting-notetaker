from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker"
    bot_service_token: str = "dev-bot-token-12345"
    bot_runner_url: str = "http://localhost:3001"
    
    # Whisper Transcription Settings
    whisper_groq_api: str = ""
    whisper_model: str = "whisper-large-v3"
    groq_api_base_url: str = "https://api.groq.com/openai/v1"
    
    class Config:
        env_file = ".env"


settings = Settings()
