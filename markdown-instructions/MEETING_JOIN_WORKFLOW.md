# Meeting Join Workflow - Complete Architecture

## High-Level Overview

```
┌─────────────────┐
│  Meeting URL    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BOT-RUNNER (Node.js)                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Step 1: Fetch Meeting Metadata from Webex                     │   │
│  │                                                                 │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ Call: GET /meetings?webLink={encoded_url}    │             │   │
│  │  │ API:  https://webexapis.com/v1/meetings      │             │   │
│  │  │ Auth: Bot Access Token                        │             │   │
│  │  └──────────────┬───────────────────────────────┘             │   │
│  │                 │                                               │   │
│  │                 ▼ Returns                                       │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ {                                             │             │   │
│  │  │   id: "abc123xyz",        ← webex_meeting_id │             │   │
│  │  │   meetingNumber: "123456789",                 │             │   │
│  │  │   hostEmail: "host@example.com",              │             │   │
│  │  │   start: "2025-10-11T14:00:00Z",             │             │   │
│  │  │   end: "2025-10-11T15:00:00Z",               │             │   │
│  │  │   scheduledType: "personalRoomMeeting"       │             │   │
│  │  │ }                                             │             │   │
│  │  └──────────────┬───────────────────────────────┘             │   │
│  │                 │                                               │   │
│  │                 ▼                                               │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ Call: GET /meetingParticipants?meetingId={id}│             │   │
│  │  │ API:  https://webexapis.com/v1/...           │             │   │
│  │  │ Auth: Bot Access Token                        │             │   │
│  │  └──────────────┬───────────────────────────────┘             │   │
│  │                 │                                               │   │
│  │                 ▼ Returns                                       │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ [                                             │             │   │
│  │  │   "user1@example.com",                       │             │   │
│  │  │   "user2@example.com",                       │             │   │
│  │  │   "user3@example.com"                        │             │   │
│  │  │ ]                                             │             │   │
│  │  └───────────────────────────────────────────────┘             │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Step 2: Register Meeting with Backend                         │   │
│  │                                                                 │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ Call: POST /meetings/register                 │             │   │
│  │  │ API:  http://localhost:8000/meetings/register │             │   │
│  │  │ Auth: Bot Service Token                       │             │   │
│  │  │                                               │             │   │
│  │  │ Body: {                                       │             │   │
│  │  │   meeting_link: "https://...",                │             │   │
│  │  │   webex_meeting_id: "abc123xyz",             │             │   │
│  │  │   meeting_number: "123456789",               │             │   │
│  │  │   host_email: "host@example.com",            │             │   │
│  │  │   participant_emails: [...],                 │             │   │
│  │  │   scheduled_start_time: "2025-10-11...",    │             │   │
│  │  │   scheduled_end_time: "2025-10-11...",      │             │   │
│  │  │   is_personal_room: true,                    │             │   │
│  │  │   meeting_type: "meeting",                   │             │   │
│  │  │   scheduled_type: "personalRoomMeeting"     │             │   │
│  │  │ }                                             │             │   │
│  │  └──────────────┬───────────────────────────────┘             │   │
│  │                 │                                               │   │
│  └─────────────────┼───────────────────────────────────────────────   │
└───────────────────┼─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (Python/FastAPI)                         │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Backend Processing: /meetings/register                        │   │
│  │                                                                 │   │
│  │  1. Query Database for existing meeting                        │   │
│  │     WHERE webex_meeting_id = "abc123xyz"                       │   │
│  │                                                                 │   │
│  │  ┌────────────────┐        ┌────────────────────┐             │   │
│  │  │ IF EXISTS      │        │ IF NOT EXISTS      │             │   │
│  │  │ (Bot Rejoining)│        │ (First Join)       │             │   │
│  │  └────┬───────────┘        └────┬───────────────┘             │   │
│  │       │                          │                              │   │
│  │       ▼                          ▼                              │   │
│  │  ┌─────────────────┐       ┌───────────────────┐             │   │
│  │  │ - Reactivate    │       │ - Create new      │             │   │
│  │  │ - Set active=T  │       │ - Generate UUID   │             │   │
│  │  │ - Update join   │       │ - Set active=T    │             │   │
│  │  │   time          │       │ - Save to DB      │             │   │
│  │  │ - Query last    │       │                   │             │   │
│  │  │   chunk_id      │       │                   │             │   │
│  │  └─────────────────┘       └───────────────────┘             │   │
│  │                                                                 │   │
│  │  2. Query audio_chunks table                                   │   │
│  │     SELECT MAX(chunk_id)                                       │   │
│  │     WHERE meeting_id = meeting_uuid                            │   │
│  │                                                                 │   │
│  │  3. Return Response                                            │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────┐              │
│  │ Response: {                                          │              │
│  │   meeting_uuid: "550e8400-e29b-41d4-a716-446655...",│              │
│  │   webex_meeting_id: "abc123xyz",                    │              │
│  │   is_new: false,                                     │              │
│  │   last_chunk_id: 42,  ← Bot continues from #43     │              │
│  │   message: "Meeting reactivated - chunk continues"  │              │
│  │ }                                                    │              │
│  └──────────────────────────┬──────────────────────────┘              │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BOT-RUNNER (Node.js)                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Step 3: Store Meeting UUID & Join Webex Meeting              │   │
│  │                                                                 │   │
│  │  this.meetingUrl = "https://..."                               │   │
│  │  this.meetingUuid = "550e8400-..."  ← Use for all operations  │   │
│  │  this.webexMeetingId = "abc123xyz"                             │   │
│  │  this.hostEmail = "host@example.com"                           │   │
│  │                                                                 │   │
│  │  Initialize Webex SDK and join meeting...                      │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Step 4: Audio Processing Loop                                 │   │
│  │                                                                 │   │
│  │  Every 10 seconds:                                             │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ 1. Capture audio chunk from Webex stream     │             │   │
│  │  │ 2. Convert WebM → WAV (ffmpeg)               │             │   │
│  │  │ 3. Send to backend with meeting_uuid         │             │   │
│  │  └──────────────┬───────────────────────────────┘             │   │
│  │                 │                                               │   │
│  │                 ▼                                               │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ Call: POST /audio/chunk                       │             │   │
│  │  │ API:  http://localhost:8000/audio/chunk       │             │   │
│  │  │ Auth: Bot Service Token                       │             │   │
│  │  │                                               │             │   │
│  │  │ FormData:                                     │             │   │
│  │  │   meeting_id: "550e8400-..." ← UUID          │             │   │
│  │  │   chunk_id: 43                                │             │   │
│  │  │   audio_file: [WAV binary]                    │             │   │
│  │  │   host_email: "host@example.com"              │             │   │
│  │  │   audio_started_at: "2025-10-11T14:05:20Z"   │             │   │
│  │  │   audio_ended_at: "2025-10-11T14:05:30Z"     │             │   │
│  │  └───────────────────────────────────────────────┘             │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Step 5: On Meeting Leave/End                                  │   │
│  │                                                                 │   │
│  │  ┌──────────────────────────────────────────────┐             │   │
│  │  │ Call: PATCH /meetings/{uuid}/status           │             │   │
│  │  │ API:  http://localhost:8000/meetings/550e.../│             │   │
│  │  │ Auth: Bot Service Token                       │             │   │
│  │  │                                               │             │   │
│  │  │ Body: {                                       │             │   │
│  │  │   is_active: false,                           │             │   │
│  │  │   actual_leave_time: "2025-10-11T15:00:00Z" │             │   │
│  │  │ }                                             │             │   │
│  │  └───────────────────────────────────────────────┘             │   │
│  └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Reference Summary

### 1. Webex List Meetings API
**Endpoint**: `GET https://webexapis.com/v1/meetings`  
**Purpose**: Fetch meeting metadata including unique meeting ID  
**Auth**: Bot Access Token (Bearer)  
**Query Params**:
- `webLink`: URL-encoded meeting URL
- `meetingType`: "scheduledMeeting"
- `max`: 1

**Response Fields Used**:
- `id` → `webex_meeting_id` (unique per instance)
- `meetingNumber` → User-friendly number
- `hostEmail` → Meeting host
- `start` → Scheduled start time
- `end` → Scheduled end time
- `scheduledType` → "personalRoomMeeting" or "meeting"

---

### 2. Webex List Meeting Participants API
**Endpoint**: `GET https://webexapis.com/v1/meetingParticipants`  
**Purpose**: Fetch list of participant emails  
**Auth**: Bot Access Token (Bearer)  
**Query Params**:
- `meetingId`: The `webex_meeting_id` from previous call
- `max`: 100

**Response**: Array of participant objects with `email` field

---

### 3. Backend Meeting Registration API
**Endpoint**: `POST http://localhost:8000/meetings/register`  
**Purpose**: Create or reactivate meeting record, get internal UUID  
**Auth**: Bot Service Token (Bearer)  
**Request Body**: All metadata from Webex APIs  
**Response**:
- `meeting_uuid`: Internal UUID for all operations
- `is_new`: Boolean (new vs rejoining)
- `last_chunk_id`: Last chunk number (for continuation)

**Database Operation**:
- Check if `webex_meeting_id` exists
- If yes: Reactivate and return existing UUID + last chunk ID
- If no: Create new record with new UUID

---

### 4. Backend Audio Chunk API
**Endpoint**: `POST http://localhost:8000/audio/chunk`  
**Purpose**: Store audio chunk with meeting UUID reference  
**Auth**: Bot Service Token (Bearer)  
**Content-Type**: `multipart/form-data`  
**Form Fields**:
- `meeting_id`: Meeting UUID (foreign key to meetings table)
- `chunk_id`: Sequential number
- `audio_file`: WAV binary
- `host_email`: Meeting host
- `audio_started_at`: Chunk start timestamp
- `audio_ended_at`: Chunk end timestamp

**Database Operation**:
- Insert into `audio_chunks` table with `meeting_id = meeting_uuid`
- Trigger background transcription

---

### 5. Backend Meeting Status API
**Endpoint**: `PATCH http://localhost:8000/meetings/{meeting_uuid}/status`  
**Purpose**: Update meeting active status  
**Auth**: Bot Service Token (Bearer)  
**Request Body**:
- `is_active`: Boolean
- `actual_leave_time`: ISO timestamp

**Database Operation**:
- Update `meetings` table: `is_active`, `actual_leave_time`

---

## Key Design Features

### ✅ Chunk Continuation on Rejoin
```
Bot joins → Meeting already exists → Returns last_chunk_id = 42
→ Bot continues with chunk #43, #44, #45...
```

### ✅ Personal Room Uniqueness
```
Same personal room URL at different times:
- Monday 2pm: webex_meeting_id = "abc123" → UUID1
- Tuesday 3pm: webex_meeting_id = "xyz789" → UUID2
Each gets separate record, separate chunks ✓
```

### ✅ Foreign Key Integrity
```
meetings (UUID primary key)
  ├── audio_chunks (meeting_id FK)
  ├── speaker_events (meeting_id FK)
  └── speaker_transcripts (meeting_id FK)
```

### ✅ Status Tracking
```
Join:  is_active=True,  actual_join_time set
Leave: is_active=False, actual_leave_time set
```

---

## File References

**Bot-Runner Files**:
- `services/bot-runner/src/shared/api/webex-api.js` - Webex API calls
- `services/bot-runner/src/shared/api/http-client.js` - Backend API calls
- `services/bot-runner/src/headless/webex-client.js` - Regular workflow
- `services/bot-runner/src/headless/webex-client-multistream.js` - Multistream workflow

**Backend Files**:
- `services/backend/app/models/meeting.py` - Meeting model
- `services/backend/app/api/meetings.py` - Meeting endpoints
- `services/backend/app/api/audio.py` - Audio chunk endpoint
- `services/backend/app/services/webex_api.py` - Backend Webex client (unused in current flow)

---

## Environment Variables Required

**Backend** (`services/backend/.env`):
```bash
WEBEX_CLIENT_ID=your_client_id
WEBEX_CLIENT_SECRET=your_client_secret
BOT_SERVICE_TOKEN=your_secure_token
DATABASE_URL=postgresql://...
```

**Bot-Runner** (`services/bot-runner/.env`):
```bash
WEBEX_BOT_ACCESS_TOKEN=your_bot_access_token
BOT_SERVICE_TOKEN=your_secure_token  # Same as backend
BACKEND_API_URL=http://localhost:8000
```

