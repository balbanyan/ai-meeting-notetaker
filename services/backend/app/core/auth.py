from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

# Create security scheme
security = HTTPBearer()


def verify_bot_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify bot service token"""
    if credentials.credentials != settings.bot_service_token:
        raise HTTPException(status_code=401, detail="Invalid bot service token")
    return credentials.credentials
