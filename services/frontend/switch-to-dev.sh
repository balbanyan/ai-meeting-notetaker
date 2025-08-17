#!/bin/bash
echo "Switching to development mode (using access token)..."

# Backup original files
cp src/app/page.tsx src/app/page-oauth.tsx.bak 2>/dev/null || true
cp src/components/providers.tsx src/components/providers-oauth.tsx.bak 2>/dev/null || true

# Switch to dev versions
cp src/app/page-dev.tsx src/app/page.tsx
cp src/components/providers-dev.tsx src/components/providers.tsx

echo "✅ Switched to development mode"
echo "Make sure to set NEXT_PUBLIC_WEBEX_ACCESS_TOKEN in .env.local"
