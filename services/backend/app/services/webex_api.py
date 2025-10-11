import httpx
from typing import Optional, Dict, List
from urllib.parse import quote


class WebexMeetingsAPI:
    """
    Client for interacting with Webex REST APIs to fetch meeting metadata.
    Uses Webex Service App refresh token for authentication.
    """
    
    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        self.base_url = "https://webexapis.com/v1"
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.access_token: Optional[str] = None  # Cached access token
    
    async def _get_access_token(self) -> str:
        """
        Get OAuth access token using refresh token.
        Webex Service Apps use refresh_token grant, not client_credentials.
        Caches the token for reuse.
        """
        # If we already have a cached access token, use it
        if self.access_token:
            return self.access_token
        
        print("🔑 Generating OAuth access token from refresh token...")
        token_url = "https://webexapis.com/v1/access_token"
        
        async with httpx.AsyncClient() as client:
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
                
                print("✅ OAuth access token generated successfully")
                return self.access_token
            else:
                error_detail = response.text
                print(f"❌ OAuth token generation failed: {response.status_code} - {error_detail}")
                raise Exception(f"Failed to get access token: {response.status_code} - {error_detail}")
    
    async def get_meeting_by_link(self, meeting_link: str) -> Optional[Dict]:
        """
        Call GET /meetings?webLink={encoded_link}&meetingType=scheduledMeeting
        Returns meeting details including id, hostEmail, start, end, scheduledType
        
        API Reference: https://developer.webex.com/meeting/docs/api/v1/meetings/list-meetings
        """
        try:
            access_token = await self._get_access_token()
            
            # URL-encode the meeting link
            encoded_link = quote(meeting_link, safe='')
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}/meetings",
                    params={
                        "webLink": encoded_link,
                        # Removed meetingType filter to support all meeting types
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
                        return items[0]  # Return first meeting
                    else:
                        print(f"⚠️ No meeting found for link: {meeting_link}")
                        return None
                else:
                    print(f"❌ List Meetings API error: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            print(f"❌ Failed to get meeting by link: {str(e)}")
            return None
    
    async def get_meeting_participants(self, webex_meeting_id: str) -> List[str]:
        """
        Call GET /meetingParticipants?meetingId={webex_meeting_id}
        Returns list of participant emails
        
        API Reference: https://developer.webex.com/meeting/docs/api/v1/meeting-participants/list-meeting-participants
        """
        try:
            access_token = await self._get_access_token()
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}/meetingParticipants",
                    params={
                        "meetingId": webex_meeting_id,
                        "max": 100  # Get up to 100 participants
                    },
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    items = data.get("items", [])
                    
                    # Extract emails from participants
                    participant_emails = []
                    for participant in items:
                        email = participant.get("email") or participant.get("hostEmail")
                        if email:
                            participant_emails.append(email)
                    
                    print(f"✅ Retrieved {len(participant_emails)} participant emails")
                    return participant_emails
                else:
                    print(f"❌ List Participants API error: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            print(f"❌ Failed to get meeting participants: {str(e)}")
            return []
    
    def extract_meeting_metadata(self, api_response: Dict) -> Dict:
        """
        Parse API response from get_meeting_by_link and extract relevant fields.
        
        Returns dict with:
        - webex_meeting_id: Unique meeting ID from Webex
        - meeting_number: User-friendly numeric ID
        - host_email: Meeting host email
        - scheduled_start_time: ISO 8601 datetime string
        - scheduled_end_time: ISO 8601 datetime string
        - is_personal_room: Boolean
        - meeting_type: meeting/webinar
        - scheduled_type: meeting/webinar/personalRoomMeeting
        """
        if not api_response:
            return {}
        
        return {
            "webex_meeting_id": api_response.get("id"),
            "meeting_number": api_response.get("meetingNumber"),
            "host_email": api_response.get("hostEmail"),
            "scheduled_start_time": api_response.get("start"),
            "scheduled_end_time": api_response.get("end"),
            "is_personal_room": api_response.get("scheduledType") == "personalRoomMeeting",
            "meeting_type": api_response.get("meetingType"),
            "scheduled_type": api_response.get("scheduledType")
        }
    
    async def get_full_meeting_metadata(self, meeting_link: str) -> Optional[Dict]:
        """
        Convenience method to get complete meeting metadata including participants.
        
        Workflow:
        1. Call get_meeting_by_link() to get meeting details (list_meetings API)
        2. Extract webex_meeting_id
        3. Call get_meeting_participants() to get participant emails (list_meeting_participants API)
        4. Return combined metadata
        """
        # Get meeting details
        meeting_data = await self.get_meeting_by_link(meeting_link)
        
        if not meeting_data:
            return None
        
        # Extract metadata
        metadata = self.extract_meeting_metadata(meeting_data)
        
        # Get participants if we have a meeting ID (optional, may fail without proper scope)
        webex_meeting_id = metadata.get("webex_meeting_id")
        if webex_meeting_id:
            try:
                participant_emails = await self.get_meeting_participants(webex_meeting_id)
                metadata["participant_emails"] = participant_emails
            except Exception as e:
                print(f"⚠️ Could not fetch participants (missing scope?): {str(e)}")
                metadata["participant_emails"] = []  # Continue without participants
        else:
            metadata["participant_emails"] = []
        
        return metadata

