const WebSocket = require('ws');
const { config } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AudioWebSocket');

class AudioWebSocketClient {
  constructor(meetingId) {
    this.meetingId = meetingId;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.meeting.maxRetryAttempts;
    this.reconnectDelay = config.meeting.retryDelayMs;
  }

  /**
   * Connect to the backend WebSocket for audio streaming
   */
  async connect() {
    try {
      const wsUrl = `${config.backend.wsUrl}/api/v1/ingest/audio?meetingId=${this.meetingId}`;
      logger.info(`Connecting to audio WebSocket: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${config.bot.serviceToken}`
        }
      });
      
      this.ws.on('open', () => {
        logger.info('Audio WebSocket connected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          logger.debug('Received message from backend:', message);
          
          if (message.type === 'chunk_processed') {
            logger.info(`Audio chunk ${message.chunk_number} processed successfully`);
          } else if (message.type === 'error') {
            logger.error('Backend reported error:', message.error);
          }
        } catch (error) {
          logger.error('Failed to parse WebSocket message:', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        logger.warn(`Audio WebSocket closed: ${code} - ${reason}`);
        this.isConnected = false;
        
        // Attempt to reconnect if not intentionally closed
        if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      });
      
      this.ws.on('error', (error) => {
        logger.error('Audio WebSocket error:', error);
        this.isConnected = false;
      });
      
      // Wait for connection to be established
      await this.waitForConnection();
      
    } catch (error) {
      logger.error('Failed to connect to audio WebSocket:', error);
      throw error;
    }
  }

  /**
   * Wait for WebSocket connection to be established
   */
  waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);
      
      const checkConnection = () => {
        if (this.isConnected) {
          clearTimeout(timeout);
          resolve();
        } else if (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      
      checkConnection();
    });
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
      });
    }, delay);
  }

  /**
   * Send audio chunk to backend
   */
  sendAudioChunk(audioBuffer) {
    if (!this.isConnected || !this.ws) {
      logger.warn('WebSocket not connected, dropping audio chunk');
      return false;
    }
    
    try {
      // Send binary audio data
      this.ws.send(audioBuffer);
      logger.debug(`Sent audio chunk: ${audioBuffer.byteLength} bytes`);
      return true;
    } catch (error) {
      logger.error('Failed to send audio chunk:', error);
      return false;
    }
  }

  /**
   * Close WebSocket connection
   */
  close() {
    if (this.ws) {
      logger.info('Closing audio WebSocket connection');
      this.isConnected = false;
      this.ws.close(1000, 'Bot leaving meeting');
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected and ready
   */
  isReady() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

module.exports = { AudioWebSocketClient };
