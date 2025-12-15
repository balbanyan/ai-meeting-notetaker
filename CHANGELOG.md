# Changelog

All notable changes to the AI Meeting Notetaker project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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


