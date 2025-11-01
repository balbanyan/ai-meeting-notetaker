from fastapi import HTTPException, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

# Create security scheme
security = HTTPBearer()


def verify_bot_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify bot service token"""
    if credentials.credentials != settings.bot_service_token:
        raise HTTPException(status_code=401, detail="Invalid bot service token")
    return credentials.credentials


def verify_external_api_key(api_key: str = Header(..., alias="API-Key")) -> str:
    """Verify external API key from API-Key header"""
    if not settings.external_api_key:
        raise HTTPException(
            status_code=500, 
            detail="External API key not configured on server"
        )
    
    if api_key != settings.external_api_key:
        raise HTTPException(
            status_code=401, 
            detail="Invalid or missing API key"
        )
    
    return api_key
