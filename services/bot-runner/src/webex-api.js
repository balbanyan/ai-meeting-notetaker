const axios = require('axios');
const { config } = require('./config');

class WebexAPI {
  constructor() {
    this.baseURL = config.webex.apiBaseUrl;
  }

  /**
   * Get meeting participants and extract host email
   * Reference: https://developer.webex.com/meeting/docs/api/v1/meeting-participants/list-meeting-participants
   */
  async getHostEmail(meetingId, accessToken) {
    try {
      console.log(`🔍 Fetching meeting participants...`);
      
      const response = await axios.get(`${this.baseURL}/meetingParticipants`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          meetingId: meetingId,
          max: 100  // Get up to 100 participants
        }
      });

      console.log(`✅ Retrieved ${response.data.items.length} participants`);

      // Find the host participant
      const hostParticipant = response.data.items.find(participant => participant.host === true);

      if (hostParticipant) {
        const hostEmail = hostParticipant.hostEmail || hostParticipant.email;
        console.log(`🎯 Host email found: ${hostEmail}`);
        return hostEmail;
      } else {
        console.log('⚠️ No host participant found in the meeting');
        return null;
      }

    } catch (error) {
      console.error('❌ Failed to get meeting participants:', error.message);
      
      if (error.response) {
        console.error(`API Error: ${error.response.status} - ${error.response.data.message || error.response.statusText}`);
      }
      
      return null;
    }
  }

  /**
   * Extract meeting ID from Webex meeting object
   */
  extractMeetingId(webexMeeting) {
    try {
      // Try different properties that might contain the meeting ID
      const meetingId = webexMeeting.id || 
                       webexMeeting.meetingId || 
                       webexMeeting.correlationId ||
                       webexMeeting.locusId;

      if (meetingId) {
        console.log(`📋 Meeting ID extracted successfully`);
        return meetingId;
      } else {
        console.error('❌ Could not extract meeting ID from Webex meeting object');
        console.log('Available properties:', Object.keys(webexMeeting));
        return null;
      }
    } catch (error) {
      console.error('❌ Error extracting meeting ID:', error.message);
      return null;
    }
  }

  /**
   * Get access token from Webex SDK instance
   */
  getAccessToken(webexInstance) {
    try {
      // Try different ways to get the access token
      const token = webexInstance.credentials?.access_token ||
                   webexInstance.authorization?.access_token ||
                   webexInstance.internal?.credentials?.access_token;

      if (token) {
        console.log('🔑 Access token retrieved successfully');
        return token;
      } else {
        console.error('❌ Could not retrieve access token from Webex instance');
        return null;
      }
    } catch (error) {
      console.error('❌ Error getting access token:', error.message);
      return null;
    }
  }
}

module.exports = { WebexAPI };
