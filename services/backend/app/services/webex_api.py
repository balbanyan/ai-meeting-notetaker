import httpx
import asyncio
import time
from typing import Optional, Dict, List
from urllib.parse import quote


class WebexMeetingsAPI:
    """
    Client for interacting with Webex REST APIs to fetch meeting metadata.
    Uses Webex Service App refresh token for authentication.
    """
    
    def __init__(self, client_id: str = "", client_secret: str = "", refresh_token: str = "", personal_token: str = ""):
        self.base_url = "https://webexapis.com/v1"
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.personal_token = personal_token  # Personal access token (overrides OAuth)
        self.access_token: Optional[str] = None  # Cached access token
        self._client: Optional[httpx.AsyncClient] = None  # Shared HTTP client for connection pooling
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create shared HTTP client with connection pooling."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client. Call this when done with the API."""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def _get_access_token(self) -> str:
        """
        Get OAuth access token using refresh token or personal token.
        Personal token takes priority (for testing).
        Webex Service Apps use refresh_token grant, not client_credentials.
        Caches the token for reuse.
        """
        # If personal token is provided, use it directly
        if self.personal_token:
            # Strip whitespace/newlines that might have been accidentally added
            cleaned_token = self.personal_token.strip()
            print("✅ Using personal access token from config")
            return cleaned_token
        
        # If we already have a cached access token, use it
        if self.access_token:
            return self.access_token
        
        print("🔑 Generating OAuth access token from refresh token...")
        token_url = "https://webexapis.com/v1/access_token"
        
        start_time = time.time()
        client = await self._get_client()
        response = await client.post(
            token_url,
            data={
                "grant_type": "refresh_token",  # Service Apps use refresh_token, not client_credentials
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        
        if response.status_code == 200:
            data = response.json()
            self.access_token = data.get("access_token")
            
            # Update refresh token if a new one is provided (silently cached)
            new_refresh_token = data.get("refresh_token")
            if new_refresh_token:
                self.refresh_token = new_refresh_token
            
            elapsed = time.time() - start_time
            print(f"✅ OAuth access token generated successfully ({elapsed:.2f}s)")
            return self.access_token
        else:
            error_detail = response.text
            print(f"❌ OAuth token generation failed: {response.status_code} - {error_detail}")
            raise Exception(f"Failed to get access token: {response.status_code} - {error_detail}")
    
    async def get_meeting_by_id_admin(self, meeting_id: str) -> Optional[Dict]:
        """
        Call GET /admin/meetings/{meetingId} (Admin API)
        Returns complete meeting details including metadata.
        
        API Reference: https://developer.webex.com/meeting/docs/api/v1/meetings/get-a-meeting-by-an-admin
        
        Returns:
            {
                "meeting_number": str,
                "host_email": str,
                "start": str (ISO 8601),
                "end": str (ISO 8601),
                "scheduled_type": str,  # "meeting", "webinar", "personalRoomMeeting"
                "meeting_type": str,  # "meeting", "webinar", "personalRoomMeeting", "scheduledMeeting"
                "meeting_series_id": str  # Original meeting ID for scheduled meetings (meetingSeriesId)
            }
        """
        try:
            access_token = await self._get_access_token()
            
            start_time = time.time()
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/admin/meetings/{meeting_id}",
                params={
                    "current": "true"  # Get current instance for scheduled meetings
                },
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                meeting_data = response.json()
                elapsed = time.time() - start_time
                print(f"✅ Retrieved meeting details from Admin API ({elapsed:.2f}s)")
                
                # Extract relevant fields
                return {
                    "meeting_id": meeting_data.get("id"),  # Actual meeting ID (may include timestamp for scheduled meetings)
                    "meeting_number": meeting_data.get("meetingNumber"),
                    "host_email": meeting_data.get("hostEmail"),
                    "start": meeting_data.get("start"),
                    "end": meeting_data.get("end"),
                    "scheduled_type": meeting_data.get("scheduledType"),
                    "title": meeting_data.get("title"),
                    "meeting_type": meeting_data.get("meetingType"),
                    "meeting_series_id": meeting_data.get("meetingSeriesId")
                }
            else:
                print(f"❌ Get Meeting Admin API error: {response.status_code} - {response.text}")
                return None
                    
        except Exception as e:
            print(f"❌ Failed to get meeting by ID (admin): {str(e)}")
            return None
    
    async def get_meeting_weblink(self, meeting_number: str, host_email: str) -> Optional[str]:
        """
        Call GET /meetings?meetingNumber={num}&hostEmail={email}
        Returns the meeting webLink.
        
        API Reference: https://developer.webex.com/docs/api/v1/meetings/list-meetings
        
        Args:
            meeting_number: Meeting number from admin API
            host_email: Host email from admin API
            
        Returns:
            webLink (str) - The canonical meeting URL
        """
        try:
            access_token = await self._get_access_token()
            
            start_time = time.time()
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/meetings",
                params={
                    "meetingNumber": meeting_number,
                    "hostEmail": host_email,
                    "current": "true",  # Get current instance for scheduled meetings
                    "max": 1  # We only need the first result
                },
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                items = data.get("items", [])
                
                if items:
                    weblink = items[0].get("webLink")
                    elapsed = time.time() - start_time
                    print(f"✅ Retrieved webLink from List Meetings API ({elapsed:.2f}s)")
                    return weblink
                else:
                    print(f"⚠️ No meeting found for meetingNumber={meeting_number}, hostEmail={host_email}")
                    return None
            else:
                print(f"❌ List Meetings API error: {response.status_code} - {response.text}")
                return None
                    
        except Exception as e:
            print(f"❌ Failed to get meeting weblink: {str(e)}")
            return None
    
    async def get_meeting_invitees(self, meeting_id: str, host_email: str) -> Dict:
        """
        Call GET /meeting-invitees?meetingId={id}&hostEmail={email}
        Returns separate lists for participants and cohosts.
        
        API Reference: https://developer.webex.com/docs/api/v1/meeting-invitees/list-meeting-invitees
        
        Args:
            meeting_id: Webex meeting ID
            host_email: Host email from admin API
            
        Returns:
            Dict with:
                - participant_emails: List of non-cohost invitees
                - cohost_emails: List of cohost invitees
        """
        try:
            access_token = await self._get_access_token()
            
            start_time = time.time()
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/meetingInvitees",
                params={
                    "meetingId": meeting_id,
                    "hostEmail": host_email,
                    "max": 100  # Get up to 100 invitees
                },
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )
            elapsed = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                items = data.get("items", [])
                
                # Separate participants and cohosts
                participant_emails = []
                cohost_emails = []
                
                for invitee in items:
                    email = invitee.get("email")
                    is_cohost = invitee.get("coHost", False)
                    
                    if email:
                        if is_cohost:
                            cohost_emails.append(email)
                        else:
                            participant_emails.append(email)
                
                print(f"✅ Retrieved {len(participant_emails)} participants, {len(cohost_emails)} cohosts ({elapsed:.2f}s)")
                return {
                    "participant_emails": participant_emails,
                    "cohost_emails": cohost_emails
                }
            else:
                print(f"⚠️ List Invitees API error ({elapsed:.2f}s): {response.status_code} - {response.text}")
                # Don't fail completely - return empty lists
                return {
                    "participant_emails": [],
                    "cohost_emails": []
                }
                    
        except Exception as e:
            print(f"⚠️ Failed to get meeting invitees (continuing with empty lists): {str(e)}")
            return {
                "participant_emails": [],
                "cohost_emails": []
            }
    
    async def get_complete_meeting_data(self, meeting_id: str) -> Dict:
        """
        Orchestration method that retrieves complete meeting data using 3 Webex APIs.
        
        Workflow:
        1. GET /meetings/{meetingId} (Admin API) → metadata
        2. GET /meetings?meetingNumber&hostEmail → webLink (parallel)
        3. GET /meeting-invitees → participant list (parallel)
        
        Args:
            meeting_id: Webex meeting ID from SDK
            
        Returns:
            {
                "webex_meeting_id": str,
                "meeting_number": str,
                "host_email": str,
                "scheduled_start_time": str (ISO 8601),
                "scheduled_end_time": str (ISO 8601),
                "scheduled_type": str,
                "meeting_link": str,
                "participant_emails": List[str],
                "cohost_emails": List[str],
                "title": str,
                "meeting_type": str,
                "meeting_series_id": str  # Original meeting ID for scheduled meetings (meetingSeriesId)
            }
        """
        try:
            print(f"📋 Fetching complete meeting data from Webex")
            
            # Step 1: Get admin metadata
            admin_data = await self.get_meeting_by_id_admin(meeting_id)
            
            if not admin_data:
                raise Exception("Failed to retrieve meeting metadata from Admin API")
            
            meeting_number = admin_data.get("meeting_number")
            host_email = admin_data.get("host_email")
            
            if not meeting_number or not host_email:
                raise Exception(f"Missing required fields: meeting_number={meeting_number}, host_email={host_email}")
            
            # Steps 2 & 3: Parallel calls for webLink and invitees
            parallel_start = time.time()
            print(f"🔄 Fetching webLink and invitees in parallel...")
            weblink_task = self.get_meeting_weblink(meeting_number, host_email)
            invitees_task = self.get_meeting_invitees(meeting_id, host_email)
            
            weblink, invitees = await asyncio.gather(weblink_task, invitees_task)
            parallel_elapsed = time.time() - parallel_start
            print(f"✅ Parallel fetch completed ({parallel_elapsed:.2f}s total)")
            
            if not weblink:
                raise Exception("Failed to retrieve meeting webLink")
            
            # Return combined data
            # Use meeting_id from API response (has timestamp for scheduled meetings) or fallback to input
            api_meeting_id = admin_data.get("meeting_id") or meeting_id
            result = {
                "webex_meeting_id": api_meeting_id,  # Actual meeting ID from API (may include timestamp for scheduled meetings)
                "meeting_number": meeting_number,
                "host_email": host_email,
                "scheduled_start_time": admin_data.get("start"),
                "scheduled_end_time": admin_data.get("end"),
                "meeting_link": weblink,
                "participant_emails": invitees.get("participant_emails", []),
                "cohost_emails": invitees.get("cohost_emails", []),
                "title": admin_data.get("title"),
                "scheduled_type": admin_data.get("scheduled_type"),  # "meeting", "webinar", "personalRoomMeeting"
                "meeting_type": admin_data.get("meeting_type"),  # "meeting", "webinar", "personalRoomMeeting", "scheduledMeeting"
                "meeting_series_id": admin_data.get("meeting_series_id")  # Original meeting ID for scheduled meetings
            }
            
            print(f"✅ Complete meeting data retrieved successfully")
            print(f"   Meeting Number Length: {len(meeting_number)}")
            print(f"   Host Length: {len(host_email)}")
            print(f"   WebLink Length: {len(weblink)}..." if weblink else "   WebLink: None")
            print(f"   Participants Length: {len(invitees.get('participant_emails', []))}, Cohosts Length: {len(invitees.get('cohost_emails', []))}")
            
            return result
            
        except Exception as e:
            print(f"❌ Failed to get complete meeting data: {str(e)}")
            raise

    async def find_meeting_id_by_link(self, meeting_link: str) -> Optional[str]:
        """
        Find meeting_id by matching webLink using List Meetings by Admin API.
        
        Args:
            meeting_link: Full Webex meeting URL
            
        Returns:
            meeting_id (str) if found, None otherwise
            
        Workflow:
            1. GET /meetings (List Meetings by Admin)
            2. Filter results where webLink == meeting_link
            3. Return matching meeting's id
        """
        try:
            print(f"🔍 Finding meeting by link...")
            
            access_token = await self._get_access_token()
            
            # Call List Meetings by Admin API with webLink parameter
            # The API requires either meetingNumber or webLink as a filter
            start_time = time.time()
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/admin/meetings",
                params={
                    "webLink": meeting_link,  # Search directly by webLink
                    "current": "true"  # Get current instance for scheduled meetings
                },
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )
            elapsed = time.time() - start_time
            
            if response.status_code != 200:
                error_detail = response.text
                print(f"❌ List Meetings API failed ({elapsed:.2f}s): {response.status_code}")
                print(f"   Error details: {error_detail}")
                return None
            
            data = response.json()
            meetings = data.get("items", [])
            print(f"📋 Found {len(meetings)} meeting(s) for link ({elapsed:.2f}s)")
            
            # Should return exactly one meeting
            if meetings:
                meeting_id = meetings[0]["id"]
                print(f"✅ Found meeting")
                return meeting_id
            else:
                print(f"❌ No meeting found with webLink")
                return None
                
        except httpx.TimeoutException:
            print(f"❌ Error finding meeting by link: Request timed out (cold start?)")
            return None
        except httpx.ConnectError as e:
            print(f"❌ Error finding meeting by link: Connection failed - {str(e)}")
            return None
        except Exception as e:
            print(f"❌ Error finding meeting by link: {type(e).__name__} - {str(e)}")
            return None
    
    async def get_complete_meeting_data_by_link(self, meeting_link: str) -> Dict:
        """
        Get complete meeting data starting from link only.
        
        Workflow:
            1. find_meeting_id_by_link() to get meeting_id
            2. Use EXISTING get_complete_meeting_data(meeting_id) method
               - Calls GET /meetings/{id} (admin API)
               - Calls GET /meetings?meetingNumber&hostEmail (for webLink)
               - Calls GET /meeting-invitees (for participants/cohosts)
               - Returns all metadata in same format
        """
        print(f"🔗 Getting complete meeting data from link...")
        
        # Step 1: Find meeting_id from link
        meeting_id = await self.find_meeting_id_by_link(meeting_link)
        
        if not meeting_id:
            raise Exception(f"No meeting found with the provided link")
        
        # Step 2: Use existing method (same as current workflow)
        return await self.get_complete_meeting_data(meeting_id)

