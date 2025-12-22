#!/usr/bin/env python3
"""
Quick JWT verification test script.
Run with: python test_jwt.py "your-token-here"
"""
import sys
import jwt
from app.core.config import settings

if len(sys.argv) < 2:
    print("Usage: python test_jwt.py <jwt_token>")
    sys.exit(1)

token = sys.argv[1]

print(f"Secret key length: {len(settings.jwt_secret_key)}")
print(f"Algorithm: {settings.jwt_algorithm}")
print(f"Token length: {len(token)}")
print()

try:
    # Try to decode with verification
    payload = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        audience=['voice-assistant-backend', 'mastra-agent'],
        issuer='pif-auth-service',
        options={
            "verify_signature": True,
            "verify_exp": True,
            "verify_iat": True,
            "require": ["exp", "iat", "sub", "email"]
        }
    )
    print("✅ SUCCESS! Token is valid.")
    print(f"Email: {payload.get('email')}")
    print(f"Subject: {payload.get('sub')}")
    
except jwt.InvalidSignatureError:
    print("❌ InvalidSignatureError - Secret key does not match!")
    print("\nThis means the JWT_SECRET_KEY in your .env doesn't match")
    print("the secret used to sign this token.")
    
except jwt.ExpiredSignatureError:
    print("❌ Token has expired")
    print("Get a fresh token and try again.")
    
except jwt.InvalidAudienceError:
    print("❌ Invalid audience claim")
    
except jwt.InvalidIssuerError:
    print("❌ Invalid issuer claim")
    
except jwt.MissingRequiredClaimError as e:
    print(f"❌ Missing required claim: {e}")
    
except Exception as e:
    print(f"❌ Error: {type(e).__name__}: {e}")

