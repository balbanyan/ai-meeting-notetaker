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
                - invitees_emails: List of non-cohost invitees
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
                
                # Separate invitees and cohosts
                invitees_emails = []
                cohost_emails = []
                
                for invitee in items:
                    email = invitee.get("email")
                    is_cohost = invitee.get("coHost", False)
                    
                    if email:
                        if is_cohost:
                            cohost_emails.append(email)
                        else:
                            invitees_emails.append(email)
                
                print(f"✅ Retrieved {len(invitees_emails)} invitees, {len(cohost_emails)} cohosts ({elapsed:.2f}s)")
                return {
                    "invitees_emails": invitees_emails,
                    "cohost_emails": cohost_emails
                }
            else:
                print(f"⚠️ List Invitees API error ({elapsed:.2f}s): {response.status_code} - {response.text}")
                # Don't fail completely - return empty lists
                return {
                    "invitees_emails": [],
                    "cohost_emails": []
                }
                    
        except Exception as e:
            print(f"⚠️ Failed to get meeting invitees (continuing with empty lists): {str(e)}")
            return {
                "invitees_emails": [],
                "cohost_emails": []
            }
    
    async def get_meeting_participants(self, meeting_id: str, host_email: str) -> List[str]:
        """
        Call GET /meetingParticipants to get actual participants who joined the meeting.
        
        API Reference: https://developer.webex.com/docs/api/v1/meeting-participants/list-meeting-participants
        
        Args:
            meeting_id: Webex meeting ID
            host_email: Host email for the meeting
            
        Returns:
            List of participant email addresses
        """
        try:
            access_token = await self._get_access_token()
            
            start_time = time.time()
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/meetingParticipants",
                params={
                    "meetingId": meeting_id,
                    "hostEmail": host_email,
                    "max": 100
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
                
                # Extract participant emails
                participant_emails = []
                for participant in items:
                    email = participant.get("email")
                    if email:
                        participant_emails.append(email)
                
                print(f"✅ Retrieved {len(participant_emails)} participants from meeting ({elapsed:.2f}s)")
                return participant_emails
            else:
                print(f"⚠️ List Meeting Participants API error ({elapsed:.2f}s): {response.status_code} - {response.text}")
                return []
                    
        except Exception as e:
            print(f"⚠️ Failed to get meeting participants: {str(e)}")
            return []
    
    async def get_meeting_types_from_list_admin(self, web_link: str) -> Optional[Dict]:
        """
        Get meeting_type and scheduled_type from List Meetings by Admin API.
        This API returns correct meetingType even with current=true.
        """
        try:
            access_token = await self._get_access_token()
            client = await self._get_client()
            
            start_time = time.time()
            response = await client.get(
                f"{self.base_url}/admin/meetings",
                params={
                    "webLink": web_link,
                    "current": "true"
                },
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )
            elapsed = time.time() - start_time
            
            if response.status_code == 200:
                items = response.json().get("items", [])
                if items:
                    meeting_type = items[0].get("meetingType")
                    scheduled_type = items[0].get("scheduledType")
                    print(f"✅ Got meeting types from List Admin API ({elapsed:.2f}s): meetingType={meeting_type}, scheduledType={scheduled_type}")
                    return {
                        "meeting_type": meeting_type,
                        "scheduled_type": scheduled_type
                    }
            print(f"⚠️ Could not get meeting types from List Admin API ({elapsed:.2f}s)")
            return None
        except Exception as e:
            print(f"⚠️ Failed to get meeting types from List Admin API: {str(e)}")
            return None
    
    async def get_complete_meeting_data(self, meeting_id: str, list_api_types: Optional[Dict] = None) -> Dict:
        """
        Orchestration method that retrieves complete meeting data using Webex APIs.
        
        Args:
            meeting_id: Webex meeting ID from SDK
            list_api_types: Optional dict with meeting_type and scheduled_type from List Admin API
                           (if already fetched by find_meeting_id_by_link)
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
            
            # Step 2: Parallel calls for webLink and invitees
            parallel_start = time.time()
            print(f"🔄 Fetching webLink and invitees in parallel...")
            weblink_task = self.get_meeting_weblink(meeting_number, host_email)
            invitees_task = self.get_meeting_invitees(meeting_id, host_email)
            
            weblink, invitees = await asyncio.gather(weblink_task, invitees_task)
            parallel_elapsed = time.time() - parallel_start
            print(f"✅ Parallel fetch completed ({parallel_elapsed:.2f}s total)")
            
            if not weblink:
                raise Exception("Failed to retrieve meeting webLink")
            
            # Step 3: Get correct meeting types from List Admin API
            # Use pre-fetched types if provided, otherwise fetch using weblink
            if list_api_types:
                meeting_type = list_api_types.get("meeting_type")
                scheduled_type = list_api_types.get("scheduled_type")
                print(f"✅ Using pre-fetched types: meetingType={meeting_type}, scheduledType={scheduled_type}")
            else:
                types_data = await self.get_meeting_types_from_list_admin(weblink)
                if types_data:
                    meeting_type = types_data.get("meeting_type")
                    scheduled_type = types_data.get("scheduled_type")
                else:
                    # Fallback to admin_data (may have incorrect meetingType)
                    print(f"⚠️ Falling back to Get by ID Admin API for types")
                    meeting_type = admin_data.get("meeting_type")
                    scheduled_type = admin_data.get("scheduled_type")
            
            # Return combined data
            api_meeting_id = admin_data.get("meeting_id") or meeting_id
            result = {
                "webex_meeting_id": api_meeting_id,
                "meeting_number": meeting_number,
                "host_email": host_email,
                "scheduled_start_time": admin_data.get("start"),
                "scheduled_end_time": admin_data.get("end"),
                "meeting_link": weblink,
                "invitees_emails": invitees.get("invitees_emails", []),
                "cohost_emails": invitees.get("cohost_emails", []),
                "title": admin_data.get("title"),
                "scheduled_type": scheduled_type,
                "meeting_type": meeting_type,
                "meeting_series_id": admin_data.get("meeting_series_id")
            }
            
            print(f"✅ Complete meeting data retrieved successfully")
            print(f"   Meeting Type: {meeting_type}, Scheduled Type: {scheduled_type}")
            
            return result
            
        except Exception as e:
            print(f"❌ Failed to get complete meeting data: {str(e)}")
            raise

    async def find_meeting_id_by_link(self, meeting_link: str) -> Optional[Dict]:
        """
        Find meeting by webLink using List Meetings by Admin API.
        Returns meeting_id, meeting_type, and scheduled_type.
        
        Args:
            meeting_link: Full Webex meeting URL
            
        Returns:
            Dict with meeting_id, meeting_type, scheduled_type if found, None otherwise
        """
        try:
            print(f"🔍 Finding meeting by link...")
            
            access_token = await self._get_access_token()
            
            start_time = time.time()
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/admin/meetings",
                params={
                    "webLink": meeting_link,
                    "current": "true"
                },
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )
            elapsed = time.time() - start_time
            
            if response.status_code != 200:
                print(f"❌ List Meetings by Admin API failed ({elapsed:.2f}s): {response.status_code}")
                return None
            
            data = response.json()
            meetings = data.get("items", [])
            print(f"📋 Found {len(meetings)} meeting(s) for link ({elapsed:.2f}s)")
            
            if meetings:
                meeting = meetings[0]
                print(f"✅ Found meeting (meetingType: {meeting.get('meetingType')}, scheduledType: {meeting.get('scheduledType')})")
                return {
                    "meeting_id": meeting.get("id"),
                    "meeting_type": meeting.get("meetingType"),
                    "scheduled_type": meeting.get("scheduledType")
                }
            else:
                print(f"❌ No meeting found with webLink")
                return None
                
        except httpx.TimeoutException:
            print(f"❌ Error finding meeting by link: Request timed out")
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
            1. find_meeting_id_by_link() to get meeting_id and types from List Admin API
            2. Pass types to get_complete_meeting_data() to avoid duplicate API call
        """
        print(f"🔗 Getting complete meeting data from link...")
        
        # Step 1: Find meeting_id and types from List Admin API
        link_result = await self.find_meeting_id_by_link(meeting_link)
        
        if not link_result:
            raise Exception(f"No meeting found with the provided link")
        
        # Step 2: Pass types from List Admin API
        list_api_types = {
            "meeting_type": link_result.get("meeting_type"),
            "scheduled_type": link_result.get("scheduled_type")
        }
        return await self.get_complete_meeting_data(link_result["meeting_id"], list_api_types=list_api_types)

