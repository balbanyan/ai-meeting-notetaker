# Visual Workflow Summary - EMBEDDED APP ONLY

## 🆕 EMBEDDED APP WORKFLOW (ONLY SUPPORTED WORKFLOW)

```
┌─────────────────────────────────────────────────────────────────┐
│                    EMBEDDED APP IN WEBEX MEETING                │
│                    (Frontend - React/JavaScript)                │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                │ 1. User joins meeting, app gets meeting_id from SDK
                                │    const meeting = await app.context.getMeeting()
                                │    meeting.id = "abc123xyz"
                                │
                                ▼
                    POST /embedded/register-and-join
                    Body: { meeting_id: "abc123xyz" }
                                │
┌───────────────────────────────┼─────────────────────────────────┐
│                    BACKEND (Python/FastAPI)                      │
│                    /embedded/register-and-join                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  2. Call WebexMeetingsAPI.get_complete_meeting_data()           │
│     ┌────────────────────────────────────────────┐             │
│     │ ⚡ PARALLEL API CALLS TO WEBEX:            │             │
│     │                                             │             │
│     │ A. GET /meetings/{meetingId}  (Admin API)  │             │
│     │    → meeting_number, host_email, times     │             │
│     │                                             │             │
│     │ B. GET /meetings?meetingNumber&hostEmail   │             │
│     │    → webLink (the actual meeting URL!)     │             │
│     │                                             │             │
│     │ C. GET /meeting-invitees                   │             │
│     │    → participant_emails[]                  │             │
│     └────────────────────────────────────────────┘             │
│                                                                  │
│  3. Database Operations:                                        │
│     - Query: Check if webex_meeting_id exists                  │
│     - Insert/Update: meetings table with fetched metadata      │
│     - Store: meeting_uuid (internal ID)                        │
│                                                                  │
│  4. Trigger Bot-Runner:                                         │
│     POST http://localhost:3001/join                             │
│     Body: {                                                     │
│       meetingUrl: <webLink from step 2B>,                      │
│       meetingUuid: <from database>,                            │
│       hostEmail: <from step 2A>                                │
│     }                                                           │
│                                                                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BOT-RUNNER (Node.js/Puppeteer)               │
│                    Receives: POST /join                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  5. Receives meetingUuid directly (no backend call needed!)     │
│  6. Launch headless browser                                     │
│  7. Join meeting using webLink                                  │
│  8. Start capturing audio (multistream)                         │
│  9. Every 10 seconds:                                           │
│     → POST /audio/chunk (with meetingUuid)                      │
│       (audio data + timing + meeting_uuid)                      │
│                                                                  │
│  10. On speaker change (multistream):                           │
│      → POST /events/speaker-started (with meetingUuid)          │
│        (speaker_id + timestamp)                                 │
│                                                                  │
│  11. On leave:                                                  │
│      → PATCH /meetings/{meetingUuid}/status                     │
│        (is_active: false)                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                   [Audio Processing Pipeline]
                   → Transcription (Groq Whisper)
                   → Speaker Mapping (multistream)
                   → Database Storage
```

---

## 🔄 SHARED COMPONENTS (Used by Workflow)

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUDIO PROCESSING PIPELINE                     │
│                    (Triggered by Bot-Runner)                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Bot-Runner sends:                                              │
│  POST /audio/chunk                                              │
│    ↓                                                             │
│  Backend receives WAV audio                                     │
│    ↓                                                             │
│  Database: Insert into audio_chunks table                       │
│    ↓                                                             │
│  Background Task: transcribe_chunk_async()                      │
│    ├── Groq Whisper API: Transcribe audio                      │
│    ├── Database: Update chunk with transcript                   │
│    └── AudioSpeakerMapper:                                      │
│        ├── Query speaker_events for timeframe                   │
│        ├── Map transcript sentences to speakers                 │
│        └── Save to speaker_transcripts table                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    MEETING STATUS MANAGEMENT                     │
│                    (Used by Bot-Runner)                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Bot-Runner on meeting leave:                                   │
│  PATCH /meetings/{uuid}/status                                  │
│    ↓                                                             │
│  Backend updates:                                               │
│    - is_active = false                                          │
│    - actual_leave_time = <timestamp>                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 ACTIVE API ENDPOINTS

### Backend API Endpoints

| Endpoint | Purpose | Used By |
|----------|---------|---------|
| `POST /embedded/register-and-join` | Register meeting and trigger bot join | Embedded App Frontend |
| `POST /audio/chunk` | Save audio chunks | Bot-Runner |
| `GET /audio/chunks/count` | Get chunk continuation info | Bot-Runner |
| `PATCH /meetings/{uuid}/status` | Update meeting status | Bot-Runner |
| `POST /events/speaker-started` | Record speaker events | Bot-Runner (multistream) |

### ❌ REMOVED Endpoints (Legacy)
- `POST /meetings/join` - REMOVED (was: Manual bot trigger)
- `POST /meetings/fetch-and-register` - REMOVED (was: Bot self-registration)

---

### Webex API Methods (webex_api.py)

| Method | Purpose | Webex API Called |
|--------|---------|------------------|
| `get_complete_meeting_data()` | Fetch all meeting metadata | Admin + List + Invitees APIs |
| `get_meeting_by_id_admin()` | Get meeting details by ID | `GET /meetings/{id}` |
| `get_meeting_weblink()` | Get meeting URL | `GET /meetings?meetingNumber` |
| `get_meeting_invitees()` | Get participant list | `GET /meeting-invitees` |

### ❌ REMOVED Methods (Legacy)
- `get_full_meeting_metadata()` - REMOVED
- `get_meeting_by_link()` - REMOVED
- `get_meeting_participants()` - REMOVED
- `extract_meeting_metadata()` - REMOVED

---

### Bot-Runner Clients

| Client | Status | Features |
|--------|--------|----------|
| `webex-client-multistream.js` | ✅ **ACTIVE** | Multistream API, speaker detection, audio capture |
| `webex-client.js` | ⚠️ **LEGACY** | Legacy media API (kept for compatibility) |

---

## 🎯 KEY WORKFLOW CHARACTERISTICS

### Data Flow Direction

**Embedded App Workflow:**
```
Frontend → Backend → Webex APIs → Database → Bot-Runner → Meeting
         (Embedded App passes meeting_id)
                  (Backend fetches metadata & registers)
                           (Backend passes meetingUuid to bot)
                                    (Bot joins with UUID)
```

### Webex API Strategy

**Current Approach:**
- Input: `meeting_id` (from Webex SDK)
- API: Admin API (`GET /meetings/{meetingId}`)
- Advantage: More reliable, gets canonical meeting data
- Result: Fetches `webLink` to give to bot

### Registration Flow

**Current Flow:**
1. Frontend gets `meeting_id` from SDK
2. Backend fetches complete metadata from Webex APIs
3. Backend registers meeting in database → generates `meeting_uuid`
4. Backend triggers bot with fetched URL **+ meetingUuid + hostEmail**
5. Bot receives UUID directly, no need to call backend again
6. Bot starts audio capture and speaker tracking

---

## 🔧 IMPLEMENTATION FILES

### Embedded App Workflow Files
```
Backend:
  - app/api/embedded.py                    (Entry point)
  - app/services/webex_api.py              (Admin API methods)
  - app/models/meeting.py                  (Database model)
  - app/api/audio.py                       (Audio chunk endpoint)
  - app/api/speaker_events.py              (Speaker events endpoint)

Frontend:
  - services/frontend/src/App.jsx          (Embedded app UI)
  - services/frontend/src/api/client.js    (API calls)

Bot-Runner:
  - services/backend/bot-runner/src/headless/manager.js
  - services/backend/bot-runner/src/headless/webex-client-multistream.js
  - services/backend/bot-runner/src/shared/api/http-client.js
```

### Shared Components
```
Backend:
  - app/services/transcription.py          (Groq Whisper service)
  - app/services/audio_speaker_mapper.py   (Speaker mapping service)
  - app/models/audio_chunk.py              (Audio chunk model)
  - app/models/speaker_event.py            (Speaker event model)
  - app/models/speaker_transcript.py       (Speaker transcript model)

Bot-Runner:
  - src/shared/audio/processor.js          (Audio processing)
  - src/shared/config/index.js             (Configuration)
```

---

## ✨ ARCHITECTURE BENEFITS

### Single Clean Workflow ✅
- **One entry point**: `/embedded/register-and-join`
- **One Webex API strategy**: Admin API orchestration
- **No redundancy**: Single backend registration, no duplicate API calls
- **Multistream-first**: Optimized for speaker detection and attribution

### Simplified Flow ✅
- **Embedded app** triggers everything
- **Backend** handles all Webex API complexity
- **Bot-runner** receives ready-to-use UUID
- **No self-registration** needed by bot

### Performance ✅
- **Parallel API calls**: 3 Webex APIs called simultaneously
- **No redundant calls**: Bot doesn't re-fetch metadata
- **Direct UUID passing**: Faster bot initialization
- **Efficient speaker mapping**: Real-time speaker attribution

### Maintainability ✅
- **~800 fewer lines of code** (removed legacy endpoints and methods)
- **Clear separation**: Frontend → Backend → Bot
- **Single source of truth**: Database UUID drives everything
- **Consistent error handling**: Centralized in backend

---

## 📝 MIGRATION NOTES

### What Changed
1. ❌ Removed `/meetings/join` endpoint
2. ❌ Removed `/meetings/fetch-and-register` endpoint
3. ❌ Removed legacy Webex API methods (4 methods)
4. ❌ Removed `fetchAndRegisterMeeting()` from bot-runner clients
5. ✅ Bot-runner now receives `meetingUuid` directly from backend
6. ✅ Multistream client simplified (no backend registration call)
7. ⚠️ Legacy bot-runner client kept for compatibility

### What Stayed the Same
1. ✅ Audio processing pipeline unchanged
2. ✅ Transcription service unchanged
3. ✅ Speaker mapping unchanged
4. ✅ Database models unchanged
5. ✅ Meeting status updates unchanged

---

## 🎉 CONCLUSION

The backend now supports a **single, streamlined workflow** optimized for embedded Webex applications:

- **Modern**: Uses Webex Admin API for reliable meeting data
- **Efficient**: No redundant API calls or duplicate registrations
- **Simple**: Clear data flow from embedded app → backend → bot
- **Maintainable**: Reduced code complexity, single workflow to support
- **Performant**: Parallel API calls, direct UUID passing

This architecture provides the **best foundation** for production Webex embedded apps with multistream audio and speaker detection! 🎯
