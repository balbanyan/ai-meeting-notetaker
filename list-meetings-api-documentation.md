# List Meetings — Webex for Developers

**API Endpoint Documentation:**  
`GET /meetings`

---

## Overview

The "List Meetings" API merges previous endpoints for meeting series and provides detailed information about meetings based on filters such as meeting number, link, type, and more.

Only meetings of the **`Meetings`** product are supported (other Webex Suite products are not supported).

*Ad-hoc meetings* created with `adhoc: true` and a `roomId` will **not** be listed (except ended and ongoing instances).

### Meeting Series
- Each scheduled meeting or series instance has its own `start`, `end`, and other properties.
- Recurring meeting series may have multiple occurrences spread across weeks, months, or years.
- All occurrences overlapping with the specified time range (`from` and `to`) are listed.

## Request Details

### Method

`GET /meetings`

### Headers

- **password**: Required if the meeting is protected and the user is not host/cohost/invitee.
- **timezone**: Response timestamps time zone (IANA compliant, defaults to `UTC`).

---

## Query Parameters

| Name             | Type     | Description                                                                                                 | Example                                                     |
|------------------|----------|-------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| meetingNumber    | string   | Meeting number (exclusive with webLink/roomId).                                                             | `"123456789"`                                               |
| webLink          | string   | URL-encoded meeting info page (exclusive).                                                                  | `"https%3A%2F%2Fgo.webex.com%2Fgo%2F..."`                  |
| roomId           | string   | Webex space ID (exclusive).                                                                                | `"Y2lzY29zcGFyazovL3VzL1JPT..."`                            |
| meetingSeriesId  | string   | Unique ID for the meeting series.                                                                           | `"25bbf831-5be9-4c25-b4b0-..."`                             |
| max              | number   | Limit maximum meetings returned (up to 100, default: 10).                                                   | `100`                                                       |
| from             | string   | Start of range (ISO 8601).                                                                                  | `"2019-03-18T09:30:00+08:00"`                               |
| to               | string   | End of range (ISO 8601, exclusive).                                                                         | `"2019-03-25T09:30:00+08:00"`                               |
| meetingType      | string   | {`meetingSeries`, `scheduledMeeting`, `meeting`} (default: `meetingSeries`).                               | `"scheduledMeeting"`                                        |
| state            | string   | Meetings to return {`active`, `scheduled`, `inProgress`, etc.}.                                             | `"inProgress"`                                              |
| scheduledType    | string   | {`meeting`, `webinar`, `personalRoomMeeting`}.                                                             | `"personalRoomMeeting"`                                     |
| isModified       | boolean  | Only return modified/unmodified scheduled meetings.                                                         | `false`                                                     |
| hasChat          | boolean  | Only ended meeting instances with or without chat logs.                                                     | `false`                                                     |
| hasRecording     | boolean  | Only ended meetings with or without recording.                                                              | `false`                                                     |
| hasTranscription | boolean  | Only ended meetings with or without transcript.                                                             | `false`                                                     |
| hasClosedCaption | boolean  | Only ended meetings with or without closed captions.                                                        | `false`                                                     |
| hasPolls         | boolean  | Only ended meetings with or without polls.                                                                  | `false`                                                     |
| hasQA            | boolean  | Only ended meetings with or without Q&A.                                                                    | `false`                                                     |
| hasSlido         | boolean  | Only ended meetings with or without Slido (Q&A or polls).                                                   | `false`                                                     |
| current          | boolean  | (With meetingNumber) get current scheduled meeting or full series.                                          | `false`                                                     |
| hostEmail        | string   | If admin, return meetings for given host's email.                                                           | `john.andersen@example.com`                                 |
| siteUrl          | string   | Specify site to list meetings from, otherwise all user's sites.                                             | `"example.webex.com"`                                       |
| integrationTag   | string   | External key for integrations (Jira, Zendesk ID etc.).                                                      | `"dbaeceebea5c4a63ac9d5ef1edfe36b9"`                        |

---

## Notes and Behavior

- If `meetingSeriesId` is provided, most other query parameters are ignored.
- `meetingNumber`, `webLink`, and `roomId` are mutually exclusive.
- Pagination is supported for long result sets.
- The `current` parameter is only for meeting series, impacts which meeting instance is returned.
- Use `Get Site List` API to discover user's available Webex sites.
- There are **special rules and restrictions** depending on the state/type/combination of query parameters.

---

## Response

- **200 OK**: Array of meetings matching the specified query.
- **4xx/5xx**: Detailed error code/messages for invalid, unauthorized, forbidden, not found, etc.

---

## Example Request

GET /meetings?meetingType=scheduledMeeting&state=inProgress&scheduledType=personalRoomMeeting&hostEmail=john.andersen@example.com
Authorization: Bearer <token>
Accept: application/json;charset=UTF-8
timezone: UTC

text

---

## Useful Links

- [Available Meeting Attributes for Different States](https://developer.webex.com/docs/meetings#available-meeting-attributes-for-different-meeting-states)
- [Webex Suite](https://www.webex.com/collaboration-suite.html)
- [Personal Room Meetings](https://help.webex.com/en-us/article/nul0wut/Webex-Personal-Rooms-in-Webex-Meetings)
- [Webex Developer Support](https://developer.webex.com/explore/support)
- [Webex Developer Community](https://community.cisco.com/t5/webex-for-developers/bd-p/disc-webex-developers)

---

© 2025 Cisco and/or its affiliates.