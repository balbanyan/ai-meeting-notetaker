const axios = require('axios');
const { config } = require('../config');

class BackendClient {
  constructor() {
    this.baseURL = config.backend.apiUrl;
    this.token = config.bot.serviceToken;
  }

  /**
   * Send audio chunk to backend
   */
  async sendAudioChunk(meetingId, chunkId, audioData, hostEmail = null, audioStartedAt = null, audioEndedAt = null) {
    try {
      // Create form data using browser FormData API (works in Electron renderer)
      const formData = new FormData();
      formData.append('meeting_id', meetingId);
      formData.append('chunk_id', chunkId);
      
      // Create blob from buffer for file upload
      const audioBlob = new Blob([audioData], { type: 'audio/wav' });
      formData.append('audio_file', audioBlob, `chunk_${chunkId}.wav`);
      
      if (hostEmail) {
        formData.append('host_email', hostEmail);
      }
      
      // Add audio timing if provided
      if (audioStartedAt) {
        formData.append('audio_started_at', audioStartedAt);
      }
      
      if (audioEndedAt) {
        formData.append('audio_ended_at', audioEndedAt);
      }

      const response = await axios.post(`${this.baseURL}/audio/chunk`, formData, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      console.log(`✅ CHUNK SENT - Chunk: ${chunkId}, Status: ${response.data.status}`);
      
      // For Electron: also log to UI if addLog function is available
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(`✅ Audio chunk sent successfully - Status: ${response.data.status}`, 'success');
      }
      
      return response.data;

    } catch (error) {
      console.error(`❌ CHUNK SEND FAILED - Chunk: ${chunkId}`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get the maximum chunk_id for a meeting to continue sequence
   */
  async getMeetingChunkCount(meetingId) {
    try {
      const response = await axios.get(`${this.baseURL}/audio/chunks/count?meeting_id=${encodeURIComponent(meetingId)}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      const maxChunkId = response.data.max_chunk_id;
      console.log(`📊 Meeting chunk count - Meeting: ${meetingId}, Max chunk ID: ${maxChunkId}`);
      return maxChunkId;
      
    } catch (error) {
      console.error(`❌ Failed to get chunk count for meeting ${meetingId}:`, error.response?.data || error.message);
      // Return 0 if there's an error (start from 1)
      return 0;
    }
  }

  /**
   * Send speaker event to backend
   */
  async sendSpeakerEvent(eventData) {
    try {
      const response = await axios.post(`${this.baseURL}/events/speaker-started`, eventData, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ SPEAKER EVENT SENT`);
      
      // For Electron: also log to UI if addLog function is available
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(`✅ Speaker event sent successfully`, 'success');
      }
      
      return response.data;

    } catch (error) {
      console.error(`❌ SPEAKER EVENT SEND FAILED`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch meeting metadata from Webex and register with backend
   * Backend handles all Webex API calls and returns meeting UUID
   */
  async fetchAndRegisterMeeting(meetingUrl) {
    try {
      console.log(`📋 Fetching and registering meeting with backend...`);
      
      const response = await axios.post(
        `${this.baseURL}/meetings/fetch-and-register`,
        { meeting_url: meetingUrl },
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { meeting_uuid, webex_meeting_id, is_new, last_chunk_id } = response.data;
      console.log(`✅ Meeting registered - UUID: ${meeting_uuid}, Is New: ${is_new}, Last Chunk: ${last_chunk_id}`);
      
      return response.data;

    } catch (error) {
      console.error(`❌ FETCH AND REGISTER FAILED`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update meeting status (active/inactive)
   */
  async updateMeetingStatus(meetingUuid, statusData) {
    try {
      const response = await axios.patch(`${this.baseURL}/meetings/${meetingUuid}/status`, statusData, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ Meeting status updated - UUID: ${meetingUuid}`);
      return response.data;

    } catch (error) {
      console.error(`❌ MEETING STATUS UPDATE FAILED`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test connection to backend
   */
  async testConnection() {
    try {
      const response = await axios.get(`${this.baseURL}/health`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      console.log('✅ Backend connection successful:', response.data);
      return response.data;
      
    } catch (error) {
      console.error('❌ Backend connection failed:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = { BackendClient };
