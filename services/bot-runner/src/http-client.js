const axios = require('axios');
const { config } = require('./config');

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

      const response = await axios.post(
        `${this.baseURL}/audio/chunk`, 
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      console.log(`✅ CHUNK SENT - Chunk: ${chunkId}, Status: ${response.data.status}`);
      return response.data;

    } catch (error) {
      console.error(`❌ CHUNK SEND FAILED - ${error.message}`);
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Error: ${error.response.data?.detail || 'Unknown error'}`);
      }
      throw error;
    }
  }

  /**
   * Test backend connection
   */
  async testConnection() {
    try {
      const response = await axios.get(`${this.baseURL}/health`);
      console.log('✅ Backend connection successful:', response.data);
      return true;
    } catch (error) {
      console.error('❌ Backend connection failed:', error.message);
      return false;
    }
  }
}

module.exports = { BackendClient };
