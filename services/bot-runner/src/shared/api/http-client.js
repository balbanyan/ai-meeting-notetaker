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
  async sendAudioChunk(meetingId, chunkId, audioData, hostEmail = null) {
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
