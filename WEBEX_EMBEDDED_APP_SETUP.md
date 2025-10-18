# Webex Embedded App - Quick Start Guide

## Overview

Your AI Meeting Notetaker now includes a Webex embedded app that allows users to add the bot to meetings directly from within Webex, without needing to manually provide meeting URLs.

## What Was Implemented

### Frontend Service (`services/frontend/`)
- ✅ React 18 + Vite application
- ✅ Dark theme UI matching Webex design
- ✅ Webex Embedded Apps SDK 2.x integration
- ✅ Meeting metadata display (title, times, type)
- ✅ One-click "Add Bot to Meeting" button
- ✅ Vercel deployment configuration
- ✅ Environment variable management

### Backend Updates
- ✅ New endpoint: `POST /embedded/register-and-join`
- ✅ Enhanced Webex API client with host detection
- ✅ Hybrid data approach (SDK + API)
- ✅ Integrated with existing bot-runner workflow

## How It Works

```
┌─────────────────┐
│ Webex Meeting   │
│   (User opens   │
│   embedded app) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Embedded App   │
│  (React + SDK)  │
│  - Get meeting  │
│    ID, title,   │
│    times, type  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  - Get parti-   │
│    cipants      │
│  - Identify     │
│    host         │
│  - Register     │
│    meeting      │
│  - Trigger bot  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Bot Runner     │
│  (Joins mtg)    │
└─────────────────┘
```

## Next Steps

### 1. Test Locally (Development)

```bash
# Terminal 1: Start backend
cd services/backend
python main.py

# Terminal 2: Start frontend
cd services/frontend
npm install
npm run dev
```

**Note:** Local testing is limited - the Webex SDK only works inside an actual Webex meeting with HTTPS.

### 2. Deploy to Vercel (Required for Testing)

#### Option A: Using Vercel CLI
```bash
cd services/frontend
npm install -g vercel
vercel
```

#### Option B: Using Vercel Dashboard
1. Go to [vercel.com](https://vercel.com)
2. Connect your GitHub repository
3. Set root directory to `services/frontend`
4. Add environment variable:
   - `VITE_BACKEND_URL` = your backend URL
5. Deploy

You'll get a URL like: `https://ai-meeting-notetaker.vercel.app`

### 3. Configure Webex Developer Portal

1. **Create Embedded App**
   - Go to: [developer.webex.com](https://developer.webex.com)
   - Click: My Webex Apps → Create a New App → Embedded App
   
2. **Configure Settings**
   ```
   App Name: AI Meeting Notetaker
   Description: Add an AI bot for automatic transcription
   Start Page URL: https://ai-meeting-notetaker.vercel.app
   Valid Domains: ai-meeting-notetaker.vercel.app
   Context: Meeting
   Layout: Sidebar
   ```

3. **Save the App**
   - Your app is now in "development mode"
   - Only visible to you in Webex meetings

### 4. Test in a Real Webex Meeting

1. Start a Webex meeting
2. Click the "Apps" button in the toolbar
3. Find "AI Meeting Notetaker" at the bottom (in-development apps)
4. Click to open
5. Accept the privacy dialog
6. Click "Add Bot to Meeting"
7. Bot should join within seconds!

## Configuration

### Backend Environment Variables
Already configured in `services/backend/.env`:
```bash
# Webex API credentials (for participant lookup)
WEBEX_CLIENT_ID=your_client_id
WEBEX_CLIENT_SECRET=your_client_secret
WEBEX_REFRESH_TOKEN=your_refresh_token
WEBEX_PERSONAL_ACCESS_TOKEN=your_token  # For testing

# Bot runner
BOT_RUNNER_URL=http://localhost:3001
```

### Frontend Environment Variables

**Development** (`services/frontend/.env`):
```bash
VITE_BACKEND_URL=http://localhost:8000
```

**Production** (Set in Vercel dashboard):
```bash
VITE_BACKEND_URL=https://your-backend.com
```

## API Endpoints

### New Embedded App Endpoint

**POST** `/embedded/register-and-join`

Registers meeting from embedded app and triggers bot join.

**Request:**
```json
{
  "meeting_id": "abc123",
  "meeting_title": "Team Standup",
  "start_time": "2025-01-01T10:00:00Z",
  "end_time": "2025-01-01T11:00:00Z",
  "meeting_type": "meeting",
  "meeting_url": "https://..."
}
```

**Response:**
```json
{
  "meeting_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "webex_meeting_id": "abc123",
  "status": "success",
  "message": "Meeting registered and bot join triggered successfully"
}
```

## File Structure

```
services/
├── frontend/                    # NEW - Embedded app
│   ├── src/
│   │   ├── App.jsx             # Main component with Webex SDK
│   │   ├── App.css             # Dark theme
│   │   ├── main.jsx            # React entry
│   │   └── api/
│   │       └── client.js       # Backend API calls
│   ├── index.html              # Webex SDK loaded here
│   ├── package.json
│   ├── vite.config.js
│   ├── vercel.json             # Deployment config
│   └── README.md               # Detailed docs
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── embedded.py     # NEW - Embedded app endpoint
│   │   │   ├── meetings.py
│   │   │   └── ...
│   │   └── services/
│   │       └── webex_api.py    # ENHANCED - Host detection
│   └── main.py                 # UPDATED - Includes embedded router
│
└── bot-runner/                  # Unchanged
```

## Key Implementation Details

### Hybrid Data Approach

The embedded app uses a **hybrid approach** to get complete meeting data:

1. **From Webex SDK** (embedded app runs in browser):
   - Meeting ID
   - Meeting title
   - Start time
   - End time
   - Meeting type

2. **From Webex API** (backend makes API call):
   - Participant emails
   - Host email (identified from participants)

This avoids unnecessary API calls while still getting complete data.

### Enhanced Webex API Client

Added new method: `get_meeting_participants_with_host(meeting_id)`

Returns:
```python
{
    "participant_emails": ["user1@example.com", "user2@example.com"],
    "host_email": "host@example.com"
}
```

Identifies host by:
1. Checking `participant.host == true` flag
2. Checking `participant.hostEmail` field
3. Falling back to first participant

## Limitations

1. **Meeting Number**: Not available from SDK (will be `null` in database)
2. **HTTPS Required**: Must deploy to test (localhost won't work)
3. **Webex Account**: Requires paid Webex account (free accounts can't create embedded apps)
4. **Development Mode**: App only visible to creator until approved by org admin

## Troubleshooting

### App Not Loading in Webex
- Verify Start Page URL in Developer Portal is correct
- Check Valid Domains includes your Vercel domain (without https://)
- Ensure app is enabled for "Meeting" context
- Try clearing Webex cache

### Bot Not Joining
- Check backend logs: `services/backend/main.py`
- Verify bot-runner is running: `http://localhost:3001`
- Check Webex API credentials are valid
- Ensure meeting URL is accessible

### SDK Errors
- Open browser DevTools in Webex (enable developer mode first)
- Check console for Webex SDK errors
- Verify SDK script is loaded in `index.html`
- Ensure `app.onReady()` completes successfully

### CORS Errors
- Backend must allow Vercel origin
- Check `allow_origins` in `services/backend/main.py`
- Current setting: `allow_origins=["*"]` (development only)

## Making It Public

To make your app available to others in your organization:

1. **Request Org Admin Approval**
   - In Developer Portal, click "Request admin approval"
   - Org admin reviews in Control Hub

2. **Submit to Webex App Hub** (optional)
   - Click "Submit to Webex App Hub"
   - Fill in submission form
   - Cisco reviews and publishes

## Resources

- [Webex Embedded Apps Guide](https://developer.webex.com/docs/embedded-apps-guide)
- [Webex SDK API Reference](https://eaf-sdk.webex.com/)
- [Frontend README](services/frontend/README.md) - Detailed frontend docs
- [Vercel Deployment](https://vercel.com/docs)

## Summary

✅ **Completed:**
- React frontend with Webex SDK integration
- Dark theme UI optimized for Webex
- Backend endpoint for embedded app
- Enhanced participant/host detection
- Vercel deployment configuration
- Complete documentation

🚀 **Ready to Deploy:**
1. Deploy frontend to Vercel
2. Configure Webex Developer Portal
3. Test in a Webex meeting
4. Start using the bot!

