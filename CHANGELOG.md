# Changelog

All notable changes to the AI Meeting Notetaker project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.5.0] - 2025-12-21

### Added
- **Live Participants Tracking**: Periodically fetch actual participants who joined the meeting
  - New `participants_emails` column stores emails from List Meeting Participants API
  - Chunk-based triggering: fetches every N chunks (configurable, default 30 = ~5 mins)
  - Only appends NEW emails not already in host, cohosts, invitees, or existing participants
  - New Celery task `fetch_meeting_participants` handles async API calls

- **New Webex API Function**: `get_meeting_participants(meeting_id, host_email)`
  - Calls `GET /meetingParticipants` endpoint
  - Returns list of participant emails from active meeting

- **Database Schema: New Columns**
  - `participants_emails` (JSON): Actual participants who joined the meeting
  - `classification` (String): Placeholder for access type (host_only / participants) - not implemented yet
  - `shared_with` (JSON): Placeholder for shared emails - not implemented yet

- **Config Setting**: `PARTICIPANTS_FETCH_INTERVAL_CHUNKS`
  - Default: 30 chunks (~5 minutes at 10-second chunk intervals)
  - Controls how often live participants are fetched during a meeting

### Changed
- **Column Rename**: `participant_emails` → `invitees_emails`
  - Clarifies this column stores pre-meeting invitees (from Meeting Invitees API)
  - Distinguishes from `participants_emails` (actual joiners from Meeting Participants API)
  - Updated all references in: `meeting.py`, `webex_api.py`, `join.py`, `frontend.py`, `schemas.py`, `status.py`

- **Meeting Type Source Fix**: `meeting_type` and `scheduled_type` now sourced from List Meetings by Admin API
  - Previous: Used Get Meeting by ID Admin API (returned incorrect `meetingType` with `current=true`)
  - Now: Uses `GET /admin/meetings?webLink=X&current=true` which returns correct values
  - Added `get_meeting_types_from_list_admin()` helper function
  - Modified `get_complete_meeting_data()` to accept optional pre-fetched types
  - `find_meeting_id_by_link()` now returns dict with `meeting_id`, `meeting_type`, `scheduled_type`

### Technical Details
- Participant fetch uses simple modulo check: `if chunk_id % interval == 0`
- Fetch task runs in Celery worker, doesn't block audio processing
- Duplicate detection is case-insensitive (emails normalized to lowercase)
- API responses updated to include `participants_emails` field

### Environment Variables Added
```bash
# Participants Tracking Settings
PARTICIPANTS_FETCH_INTERVAL_CHUNKS=30  # Fetch participants every N chunks (~5 mins at 10s chunks)
```

---

## [2.4.0] - 2025-12-18

### Added
- **Database Schema: New Columns for Meeting Identification**
  - Added `original_webex_meeting_id` column: Stores the original Webex meeting ID without timestamp
    - For scheduled meetings: Uses `meetingSeriesId` from Webex API
    - For regular meetings and personal rooms: Uses the meeting ID from embedded app (before timestamp)
  - Added `scheduled_type` column: Stores `scheduledType` from Webex API separately
    - Values: `"meeting"`, `"webinar"`, `"personalRoomMeeting"`
    - Used for personal room detection logic

- **New Status Endpoint**: `/api/meetings/status/{meeting_identifier}`
  - Lightweight endpoint to check if a bot is active for a meeting
  - Accepts both UUID and Webex meeting ID (original_webex_meeting_id)
  - Returns simple response: `{ is_active: true/false }`
  - More efficient than full meeting details endpoint for status checks

### Changed
- **Meeting Type Source**: `meeting_type` column now uses `meetingType` instead of `scheduledType`
  - Previously stored: `"meeting"`, `"webinar"`, `"personalRoomMeeting"` (from `scheduledType`)
  - Now stores: `"meeting"`, `"webinar"`, `"personalRoomMeeting"`, `"scheduledMeeting"` (from `meetingType`)
  - Allows distinguishing between meeting series and individual meetings

- **Webex API: Scheduled Meeting Support**
  - Added `current=true` parameter to all Webex Admin API calls
    - `GET /admin/meetings/{meetingId}` - Returns current instance ID with timestamp for scheduled meetings
    - `GET /meetings` (List Meetings) - Returns current instance for scheduled meetings
    - `GET /admin/meetings` (List by Admin) - Returns current instance for scheduled meetings
  - Extracts `meetingSeriesId` from API responses for scheduled meetings
  - Meeting ID from API response (with timestamp) now used for `webex_meeting_id` storage

- **Meeting Join Logic: Original Webex ID Storage**
  - For scheduled meetings (`meetingType == "scheduledMeeting"`):
    - `webex_meeting_id` = API response `id` (with timestamp, e.g., `abc123_20251218T163000Z`)
    - `original_webex_meeting_id` = `meetingSeriesId` (original series ID)
  - For regular meetings and personal rooms:
    - `webex_meeting_id` = API response `id` or `request.meeting_id`
    - `original_webex_meeting_id` = `request.meeting_id` (before timestamp for personal rooms)

- **Embedded App: Status Check Using Original Webex ID**
  - Status check now uses `original_webex_meeting_id` to determine if bot is active
  - Matches the meeting ID from embedded app for all meeting types
  - Button automatically disables when bot is active
  - Uses new lightweight `/api/meetings/status/{meetingId}` endpoint

### Technical Details
- `original_webex_meeting_id` is indexed for fast lookups
- Allows duplicate values (multiple instances of same scheduled meeting series)
- Status endpoint queries: `WHERE original_webex_meeting_id = ? AND is_active = true`
- All meeting types now correctly store and match their original Webex meeting IDs

---

## [2.3.0] - 2025-12-16

### Changed
- **Frontend Simplification**: Removed all pages except EmbeddedApp
  - Deleted `HomePage.jsx`, `MeetingDetailsPage.jsx`, and `MeetingCard.jsx` components
  - Removed React Router - `App.jsx` now directly renders `EmbeddedApp`
  - Removed `react-router-dom` dependency
  - Deleted unused CSS files for removed pages

- **API Routing with `/api` Prefix**: All API endpoints now use consistent `/api` prefix
  - Backend routes updated: `meetings`, `audio`, `screenshots`, `speaker_events` routers now include `/api` prefix
  - Health endpoints remain at root (`/health`, `/metrics`) - best practice for load balancers
  - WebSocket endpoints remain at `/ws` (no `/api` prefix)
  - Bot-runner API calls updated to use `/api` prefix for all endpoints
  - Screenshot URLs in WebSocket messages updated to `/api/screenshots/image/{id}`

- **Nginx Configuration**: Added path-based routing for same-VM deployment
  - Nginx listens on port 80 (Docker maps VM:8080 → nginx:80)
  - `/health*` and `/metrics` → proxy directly to backend
  - `/api/*` → proxy to backend (backend routes include `/api`)
  - `/ws/*` → proxy to backend with WebSocket upgrade headers
  - `/*` → serve frontend static files

- **Frontend API Client**: Switched to relative URLs
  - Removed `VITE_BACKEND_URL` requirement - frontend now uses relative URLs
  - API calls use `/api/*` paths, nginx handles routing
  - WebSocket connections use relative URLs with protocol detection
  - Frontend Dockerfile no longer requires `VITE_BACKEND_URL` build arg

### Removed
- **Frontend Pages**: Removed HomePage and MeetingDetailsPage (only EmbeddedApp remains)
- **React Router**: Removed routing infrastructure (no longer needed)
- **Environment Variable**: `VITE_BACKEND_URL` no longer required in frontend `.env`

### Technical Details
- All API endpoints are now consistent: `/api/meetings/...`, `/api/audio/...`, etc.
- Direct backend calls (Postman, localhost) also require `/api` prefix
- Frontend `.env` now only needs `VITE_DEV_MODE` (optional)
- Nginx handles all routing - simpler deployment configuration

---

## [2.2.0] - 2025-12-15

### Added
- **Multi-Database Support**: Added support for both PostgreSQL and SQL Server
  - Database type is automatically detected from connection URL
  - PostgreSQL: `postgresql://...` or `postgresql+psycopg2://...`
  - SQL Server: `mssql+pyodbc://...` or `mssql+pymssql://...`
  - Added `pyodbc>=5.0.0` driver dependency for SQL Server support

### Changed
- **Database-Agnostic Types**: Replaced PostgreSQL-specific types with database-agnostic alternatives
  - Replaced `UUID` (PostgreSQL-specific) with `Uuid` from `sqlalchemy.types` (works with both PostgreSQL and SQL Server)
  - Replaced `ARRAY` type with `JSON` for `cohost_emails` field (both databases support JSON natively)
  - Updated all 6 model files to use cross-database compatible types
  - Updated error handling in `database.py` to support both PostgreSQL and SQL Server error patterns

### Technical Details
- All UUID primary keys now use SQLAlchemy's `Uuid` type from `sqlalchemy.types`
- `cohost_emails` field now stores arrays as JSON (was PostgreSQL ARRAY)
- No changes needed to service code - SQLAlchemy handles type conversion transparently
- Existing PostgreSQL databases continue to work without migration

---

## [2.1.0] - 2025-12-14

### Added
- **HTTP Client Connection Pooling**: Webex API now reuses HTTP connections
  - Reduces latency by avoiding repeated TCP/TLS handshakes
  - Shared `httpx.AsyncClient` instance with configurable limits
  - Proper client cleanup with `close()` method

### Fixed
- **Webex Invitees API**: Fixed endpoint URL from `/meeting-invitees` to `/meetingInvitees`
  - Previous endpoint returned 404 for all requests
  - Now correctly retrieves meeting participants and cohosts

- **Webex API Indentation**: Fixed syntax errors in `webex_api.py` after connection pooling refactor

### Changed
- **Privacy: Removed Sensitive Data from Logs**
  - Removed meeting ID from join-and-register log messages
  - Removed speaker names from speaker event log messages

### Fixed
- **Screenshot URL in WebSocket Messages**: Fixed incorrect screenshot URL path in non-voting assistant broadcasts
  - Changed from `/api/screenshots/image/{screenshot_id}` to `/screenshots/image/{screenshot_id}`
  - Screenshots router is mounted without `/api` prefix, so URLs now match actual endpoint
  - Affects `palantir_service.py` where screenshot URLs are generated for WebSocket broadcasts

---

## [2.0.0] - 2025-12-01

### Added
- **Bot Timeout**: Configurable maximum duration for bot sessions (default: 3 hours)
  - New environment variable: `BOT_MAX_DURATION_MINUTES` (default: 180)
  - Bot automatically leaves meeting after timeout, triggering normal cleanup
  - Timeout resets if bot is re-added to the meeting

### Changed
- **Personal Room Session Tracking**: Personal room meetings now create unique session records
  - Each join creates a new meeting record with timestamped `webex_meeting_id` (format: `{id}_{YYYYMMDDTHHMMSSZ}`)
  - Prevents transcript/chunk accumulation across separate personal room sessions
  - Active bot check now uses `meeting_link` for personal rooms (instead of `webex_meeting_id`)
  
- **Meeting Type Fix**: `meeting_type` column now uses `scheduledType` from Webex API
  - Previously used incorrect `meetingType` field
  - Now correctly identifies: `"meeting"`, `"webinar"`, `"personalRoomMeeting"`

- **WebSocket Broadcasts**: Personal room meetings now correctly broadcast to original Webex ID
  - Ensures embedded apps receive status updates regardless of internal timestamped ID

### Fixed
- **Duplicate Bot Prevention**: Re-enabled active bot check for both personal rooms and scheduled meetings
  - Personal rooms: Checks by `meeting_link` + `is_active`
  - Scheduled meetings: Checks by `webex_meeting_id` + `is_active`

## Notes

### Environment Variables Added
```bash
# Bot Settings
BOT_MAX_DURATION_MINUTES=180  # Max bot duration in meeting (3 hours default)
```

---


