from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker_v2"
    bot_service_token: str = "dev-bot-token-12345"
    
    class Config:
        env_file = ".env"


settings = Settings()
