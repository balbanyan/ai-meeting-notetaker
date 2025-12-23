import jwt
from fastapi import HTTPException, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Dict, Any
from app.core.config import settings

# Create security scheme
security = HTTPBearer()


def verify_bot_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify bot service token"""
    if credentials.credentials != settings.bot_service_token:
        raise HTTPException(status_code=401, detail="Invalid bot service token")
    return credentials.credentials


async def decode_jwt_token(authorization: str = Header(None)) -> Dict[str, Any]:
    """
    Validate JWT token from Authorization header.
    
    Steps:
    1. Check Authorization header exists and has "Bearer " prefix
    2. Extract token string (everything after "Bearer ")
    3. Decode and validate token using shared secret key
    4. Return user information from token payload
    """
    # Step 1: Check header exists and format
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, 
            detail="Missing or invalid Authorization header. Expected: 'Bearer <token>'"
        )
    
    # Step 2: Extract token (remove "Bearer " prefix)
    token = authorization.split(" ")[1]
    
    # Step 3: Validate and decode token
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            audience=["voice-assistant-backend", "mastra-agent"],
            issuer="pif-auth-service",
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iat": True,
                "require": ["exp", "iat", "sub", "email"]
            }
        )
        
        # Step 4: Return user information from token
        return {
            "email": payload.get("email"),
            "name": payload.get("name"),
            "first_name": payload.get("first_name"),
            "last_name": payload.get("last_name"),
            "department": payload.get("department"),
            "division": payload.get("division"),
            "section": payload.get("section"),
            "employee_id": payload.get("employee_id"),
            "manager": payload.get("manager"),
        }
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidSignatureError:
        raise HTTPException(status_code=401, detail="Invalid token signature")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def decode_jwt_token_raw(token: str) -> Dict[str, Any]:
    """
    Validate JWT token string directly (for WebSocket authentication).
    
    Args:
        token: JWT token string (without "Bearer " prefix)
        
    Returns:
        User information dict from token payload
        
    Raises:
        ValueError: If token is invalid or expired
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            audience=["voice-assistant-backend", "mastra-agent"],
            issuer="pif-auth-service",
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iat": True,
                "require": ["exp", "iat", "sub", "email"]
            }
        )
        
        return {
            "email": payload.get("email"),
            "name": payload.get("name"),
            "first_name": payload.get("first_name"),
            "last_name": payload.get("last_name"),
            "department": payload.get("department"),
            "division": payload.get("division"),
            "section": payload.get("section"),
            "employee_id": payload.get("employee_id"),
            "manager": payload.get("manager"),
        }
        
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except jwt.InvalidSignatureError:
        raise ValueError("Invalid token signature")
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Invalid token: {str(e)}")


def check_meeting_access(user_email: str, meeting) -> bool:
    """
    Check if a user has access to a meeting based on classification.
    
    Classification rules:
    - "private": Only the host_email can access the meeting
    - "shared" (default): User can access if their email appears in any of:
      - host_email (single email)
      - invitees_emails (list)
      - cohost_emails (list)
      - participants_emails (list)
      - shared_with (list)
    
    Args:
        user_email: Email of the user to check
        meeting: Meeting model instance
        
    Returns:
        True if user has access, False otherwise
    """
    if not user_email:
        return False
    
    # Normalize email for comparison (case-insensitive)
    user_email_lower = user_email.lower()
    
    # Check host_email (always has access regardless of classification)
    is_host = meeting.host_email and meeting.host_email.lower() == user_email_lower
    if is_host:
        return True
    
    # Private classification: Only host can access (already checked above)
    if meeting.classification == "private":
        return False
    
    # Shared classification (default): Check all allowed lists
    # Check invitees_emails (JSON list)
    if meeting.invitees_emails:
        if any(email.lower() == user_email_lower for email in meeting.invitees_emails):
            return True
    
    # Check cohost_emails (JSON list)
    if meeting.cohost_emails:
        if any(email.lower() == user_email_lower for email in meeting.cohost_emails):
            return True
    
    # Check participants_emails (JSON list)
    if meeting.participants_emails:
        if any(email.lower() == user_email_lower for email in meeting.participants_emails):
            return True
    
    # Check shared_with (JSON list)
    if meeting.shared_with:
        if any(email.lower() == user_email_lower for email in meeting.shared_with):
            return True
    
    return False

