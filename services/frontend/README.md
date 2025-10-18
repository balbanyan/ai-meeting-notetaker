# AI Meeting Notetaker - Webex Embedded App Frontend

A React-based Webex embedded application that allows users to add an AI notetaker bot to Webex meetings directly from within the meeting interface.

## Features

- 🤖 One-click bot joining from within Webex meetings
- 📊 Real-time meeting metadata display
- 🎨 Dark theme optimized for Webex UI
- ⚡ Built with React + Vite for fast performance
- 🔒 Secure integration with Webex SDK 2.x

## Architecture

The embedded app retrieves meeting metadata directly from the Webex SDK (meeting ID, title, scheduled times) and sends it to the backend, which supplements with participant information from the Webex API before registering the meeting and triggering the bot to join.

## Local Development

### Prerequisites

- Node.js 18+ and npm
- Backend API running on `http://localhost:8000`

### Setup

1. Install dependencies:
```bash
cd services/frontend
npm install
```

2. Start development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

**Note:** For actual testing, you must deploy to a public HTTPS URL (like Vercel) since Webex embedded apps require HTTPS.

## Deployment to Vercel

### Step 1: Push to GitHub

Ensure your code is pushed to a GitHub repository.

### Step 2: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset:** Vite
   - **Root Directory:** `services/frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Add environment variable:
   - **Name:** `VITE_BACKEND_URL`
   - **Value:** Your production backend URL (e.g., `https://your-backend.com`)
6. Click "Deploy"

Your app will be live at `https://your-project.vercel.app`

### Step 3: Configure Webex Developer Portal

1. Go to [developer.webex.com](https://developer.webex.com)
2. Sign in with your Webex account
3. Navigate to "My Webex Apps" → "Create a New App" → "Create an Embedded App"
4. Fill in the form:

   **Basic Information:**
   - **Where does your app work?** Select "Meeting"
   - **Embedded app name:** AI Meeting Notetaker
   - **Description:** Add an AI notetaker bot to your Webex meetings for automatic transcription and note-taking
   - **Tagline:** Intelligent meeting notes, automatically
   - **Icon:** Upload a 512x512px icon (optional)

   **URLs and Domains:**
   - **Start Page URL:** `https://your-project.vercel.app` (your Vercel deployment URL)
   - **Valid domains:** `your-project.vercel.app` (without https://)

   **Meeting-specific Settings:**
   - **In-meeting start page URL:** (leave blank to use Start Page URL)
   - **Layout preference:** Sidebar (recommended)

5. Click "Add Embedded App"

### Step 4: Test in Webex

1. Open Webex and start a meeting
2. Click the "Apps" button in the meeting toolbar
3. Find your app at the bottom of the list (in-development apps)
4. Click to open your embedded app
5. You'll see a privacy dialog - click "Open and share my personal information"
6. The app will load, showing meeting details
7. Click "Add Bot to Meeting" to trigger the bot join

## Environment Variables

### Development (.env)
```
VITE_BACKEND_URL=http://localhost:8000
```

### Production (Vercel)
Set in Vercel dashboard:
- `VITE_BACKEND_URL` - Your production backend URL

## Webex SDK Integration

This app uses the Webex Embedded Apps SDK 2.x to:

- Initialize within the Webex meeting context
- Retrieve meeting metadata (ID, title, times, type)
- Respond to Webex theme changes
- Handle framework events

### Key SDK Methods Used

```javascript
// Initialize SDK
const app = new window.webex.Application()
await app.onReady()

// Access meeting data
const meeting = app.context.meeting
// Available: meeting.id, meeting.title, meeting.startTime, meeting.endTime
```

## API Integration

The frontend communicates with the backend API:

### POST /embedded/register-and-join

Registers the meeting and triggers bot join.

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
  "meeting_uuid": "uuid-here",
  "webex_meeting_id": "abc123",
  "status": "success",
  "message": "Meeting registered and bot join triggered successfully"
}
```

## Troubleshooting

### SDK Not Loading
- Ensure the Webex SDK script is loaded in `index.html`
- Check browser console for errors
- Verify you're testing inside a Webex meeting (not standalone browser)

### Meeting Data Not Available
- The app must run inside a Webex meeting context
- Ensure you've approved the privacy dialog
- Check that the meeting has started

### Bot Not Joining
- Verify backend API is accessible from Vercel
- Check backend logs for errors
- Ensure bot-runner service is running
- Verify Webex API credentials are configured

### CORS Errors
- Backend must allow Vercel origin in CORS settings
- Check `allow_origins` in backend `main.py`

## Development Tips

### Hot Reload
Vite provides instant hot reload during development. Just save your files and changes appear immediately.

### Debugging
- Use browser DevTools (available in Webex after enabling developer mode)
- Check console logs for SDK initialization and API calls
- Use Network tab to inspect backend API requests

### Testing Without Webex
You can test the UI locally, but SDK features won't work outside Webex. The app will show an error message.

## File Structure

```
services/frontend/
├── index.html              # HTML entry point with Webex SDK
├── package.json            # Dependencies
├── vite.config.js          # Vite configuration
├── vercel.json             # Vercel deployment config
├── .env                    # Environment variables (gitignored)
├── src/
│   ├── main.jsx           # React entry point
│   ├── App.jsx            # Main app component with SDK integration
│   ├── App.css            # Dark theme styles
│   └── api/
│       └── client.js      # Backend API client
└── README.md              # This file
```

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Webex Embedded Apps SDK 2.x** - Webex integration
- **Vercel** - Deployment platform

## Resources

- [Webex Embedded Apps Guide](https://developer.webex.com/docs/embedded-apps-guide)
- [Webex SDK API Reference](https://eaf-sdk.webex.com/)
- [Vite Documentation](https://vitejs.dev/)
- [Vercel Documentation](https://vercel.com/docs)

## Support

For issues or questions:
1. Check browser console logs
2. Review backend API logs
3. Verify Webex Developer Portal configuration
4. Ensure all environment variables are set correctly

