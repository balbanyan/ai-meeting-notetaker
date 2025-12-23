# Changelog

All notable changes to the AI Meeting Notetaker project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.7.1] - 2025-12-23

### Changed
- **[TEMPORARY] WebSocket Authentication Disabled**: JWT auth temporarily disabled for testing
  - Old endpoint `/ws/meeting` (JWT first-message auth) commented out
  - New temporary endpoint: `/ws/meeting/{meeting_identifier}` (no auth required)
  - `meeting_identifier` can be a UUID or URL-encoded meeting link
  - Original JWT code preserved with `TEMPORARILY DISABLED` markers for easy restoration

- **[TEMPORARY] Screenshot API Authentication Disabled**: JWT auth temporarily disabled
  - `GET /api/screenshots/image/{screenshot_id}` no longer requires JWT token
  - Access check bypassed (returns image directly)
  - Original auth code preserved with `TEMPORARILY DISABLED` markers

### Technical Notes
- To restore JWT auth: search for `TEMPORARILY DISABLED` comments in:
  - `app/api/websocket.py` - uncomment JWT endpoint, remove no-auth version
  - `app/api/screenshots.py` - uncomment `Depends(decode_jwt_token)` and access check

---

## [2.7.0] - 2025-12-23

### Added
- **Complete Embedded App UI Redesign**: Modern dark theme matching design guidelines
  - New 3D animated logo with "NOTETAKER" title and subheader
  - Effra font family (Light, Regular, Medium weights) for typography
  - Card-based layout for meeting information and classification
  - Meeting classification with "Private" and "Shared" radio options
  - Improved meeting ID display with subtle divider separator
  - Fun rotating loading messages during bot join (15 seconds in dev mode)

- **New WebSocket Endpoint for Embedded App**: `/ws/meeting-status/{meeting_id}`
  - Dedicated status WebSocket for embedded app (no JWT required)
  - Sends current status immediately on connection
  - Subscribes to real-time status updates using `original_webex_meeting_id`
  - Simplified frontend WebSocket client

- **Font Assets**: Added Effra font files to frontend assets
  - `Effra-Light.ttf`
  - `Effra-Regular.ttf`
  - `Effra-Medium.ttf`

### Changed
- **Embedded App Dev Mode**: Now mirrors production UI exactly
  - Inline meeting ID input placeholder instead of separate input field
  - Simulates successful bot join (15 seconds) without calling real API
  - Classification options disabled during loading

- **Meeting Status Endpoint**: Removed `verify_bot_token` from `GET /api/meetings/status/{meeting_identifier}`
  - Endpoint now accessible without bot token for embedded app use
  - Still queries by `original_webex_meeting_id` for correct matching

- **Status Broadcasting**: Backend now broadcasts to `original_webex_meeting_id`
  - Ensures embedded app receives status updates
  - Broadcasts to both `original_webex_meeting_id` and `webex_meeting_id` if different

- **UI/UX Improvements**:
  - Classification options disabled when bot is active or loading
  - Spinner animation now works (added missing `@keyframes spin`)
  - Meeting card footer with compact ID display
  - Responsive button states with loading spinner and text

### Technical Details
- Frontend WebSocket client simplified to single `connectToMeetingStatus()` function
- Backend WebSocket manager registers connections by meeting ID for targeted broadcasts
- CSS uses HSL color values with dark green theme palette
- Cards use subtle borders and shadows for depth

---

## [2.6.1] - 2025-12-22

### Added
- **Locked Meeting Lobby Support**: Bot now properly handles locked meetings with waiting rooms
  - Detects when bot is placed in lobby after joining
  - Listens for `meeting:self:guestAdmitted` event from Webex SDK
  - Waits up to 10 minutes for host to admit the bot
  - API returns immediately with `inLobby: true` status instead of hanging
  - Media setup completes automatically in background after admission

- **New Lobby-Related Features**:
  - `inLobby` property added to track lobby status
  - `/join` API now returns `{ success: true, inLobby: true, message: "Bot is waiting in lobby for host admission" }`
  - `/meetings/:id/status` endpoint includes `inLobby` field
  - Background process `waitForLobbyAdmissionAndSetupMedia()` handles post-admission setup

### Changed
- **Console Log Filtering**: Added filter to exclude verbose Webex SDK diagnostic logs
  - Filters out `wx-js-sdk`, `CallDiagnostic`, and `call-diagnostic` internal logs
  - Keeps lobby-related status logs visible for debugging

- **Bot-Runner Manager**: Updated to pass through `inLobby` status in API responses

### Fixed
- **Locked Meeting Join Failure**: Previously, bot would fail immediately with "user is still in the lobby or not joined" error when joining locked meetings. Now it waits for admission before attempting media connection.

---

## [2.6.0] - 2025-12-22

### Added
- **JWT User Authorization**: Added user-level authentication using JWT tokens
  - Users can only access meetings where their email appears in any email column
  - Checks: `host_email`, `invitees_emails`, `cohost_emails`, `participants_emails`, `shared_with`
  - New dependency: `PyJWT>=2.8.0`

- **New Auth Functions** in `app/core/auth.py`:
  - `decode_jwt_token()`: FastAPI dependency for HTTP endpoints (extracts from Authorization header)
  - `decode_jwt_token_raw()`: Direct function for WebSocket authentication
  - `check_meeting_access()`: Checks if user email has access to a meeting

- **Custom Error Handler**: Added consistent JSON error responses in `main.py`
  - 401 errors: `{"error": "Authentication required", "detail": "..."}`
  - 403 errors: `{"error": "Access denied", "detail": "..."}`
  - Other errors: `{"error": "..."}`

### Changed
- **APIs Now Require JWT Authentication**:
  - `GET /api/meetings/list`: Requires JWT, filters to user's accessible meetings only
  - `GET /api/meetings/{meeting_uuid}`: Requires JWT + access check (403 if denied)
  - `GET /api/meetings/status/{meeting_identifier}`: Requires JWT + access check
  - `GET /api/screenshots/image/{screenshot_id}`: Requires JWT + access check (verifies user has access to meeting)

- **WebSocket Endpoint Consolidated for Security**:
  - **Removed**: `/ws/meeting/{meeting_id}` and `/ws/meeting-by-link?link=...`
  - **New**: Single `/ws/meeting` endpoint with no sensitive data in URL
  - Meeting ID/link now sent in encrypted first auth message
  - Auth message format: `{"type": "auth", "token": "...", "meeting_id": "..."}` or `{"type": "auth", "token": "...", "meeting_link": "..."}`
  - Success response: `{"type": "auth_success", "meeting_id": "...", "user": {...}}`

### Removed
- **External APIs Deleted**: `/api/meetings/process-transcripts` and `/api/meetings/get-transcripts`
  - These endpoints were not used anywhere in the codebase
  - Removed `external.py`, related schemas, and `verify_external_api_key()` function

- **Unused Debugging Endpoints Deleted**:
  - `GET /api/audio/chunks/{meeting_id}` (was unused)
  - `GET /api/screenshots/{meeting_id}` (was unused)

- **Environment Variable Removed**: `EXTERNAL_API_KEY` (no longer needed)

### Environment Variables
```bash
# Add these new variables
JWT_SECRET_KEY=your-secret-key-here  # Must match auth service (min 32 chars)
JWT_ALGORITHM=HS256

# Remove this variable
# EXTERNAL_API_KEY=...  # No longer needed
```

### Migration Notes
1. Install new dependency: `pip install PyJWT>=2.8.0`
2. Add `JWT_SECRET_KEY` and `JWT_ALGORITHM` to your `.env` file
3. Remove `EXTERNAL_API_KEY` from your `.env` file
4. Update frontend to send JWT tokens in Authorization header
5. Update WebSocket clients to use new `/ws/meeting` endpoint with auth message

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


