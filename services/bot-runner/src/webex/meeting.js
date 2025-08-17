const axios = require('axios');
const { getWebexAuth } = require('../auth/webex-auth');
const { WebexAttendeesAPI } = require('./attendees');
const { AudioWebSocketClient } = require('../audio/websocket');
const { AudioProcessor } = require('../audio/processor');
const { config } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('WebexMeeting');

class WebexMeetingBot {
  constructor() {
    this.webexAuth = getWebexAuth();
    this.webex = null;
    this.currentMeeting = null;
    this.attendeesAPI = null;
    this.audioWebSocket = null;
    this.audioProcessor = null;
    this.isInMeeting = false;
    this.meetingData = null;
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      logger.info('Initializing Webex Meeting Bot...');
      
      // Step 1: Validate configuration
      logger.info('Validating configuration...');
      const { validateConfig } = require('../utils/config');
      validateConfig();
      logger.info('✅ Configuration validation passed');
      
      // Step 2: Initialize Webex authentication
      logger.info('Initializing Webex authentication...');
      this.webex = await this.webexAuth.initialize();
      
      if (!this.webex) {
        throw new Error('Webex SDK initialization returned null');
      }
      
      logger.info('✅ Webex SDK authenticated successfully');
      
      // Step 3: Initialize attendees API
      logger.info('Initializing attendees API...');
      this.attendeesAPI = new WebexAttendeesAPI(this.webex);
      logger.info('✅ Attendees API initialized');
      
      // Step 4: Test basic SDK functionality
      logger.info('Testing Webex SDK functionality...');
      try {
        // Test if we can access meetings namespace
        if (!this.webex.meetings) {
          throw new Error('Webex meetings namespace not available');
        }
        logger.info('✅ Webex meetings namespace available');
      } catch (testError) {
        logger.warn(`SDK test warning: ${testError.message}`);
      }
      
      logger.info('🎉 Webex Meeting Bot initialized successfully');
      
    } catch (error) {
      logger.error('❌ Failed to initialize Webex Meeting Bot:', error);
      
      // Cleanup on error
      this.webex = null;
      this.attendeesAPI = null;
      
      throw error;
    }
  }

  /**
   * Join a Webex meeting
   */
  async joinMeeting(meetingLinkOrId, hostEmail = null) {
    try {
      logger.info(`Joining meeting: ${meetingLinkOrId}`);
      
      // Refresh auth if needed
      await this.webexAuth.refreshIfNeeded();
      
      // Create meeting object
      this.currentMeeting = await this.webex.meetings.create(meetingLinkOrId);
      
      // Extract meeting information
      const meetingInfo = {
        webexMeetingId: this.currentMeeting.id,
        title: this.currentMeeting.title || 'Untitled Meeting',
        hostEmail: hostEmail || this.currentMeeting.hostInfo?.email || 'unknown@example.com',
        startTime: new Date().toISOString()
      };
      
      logger.info('Meeting info extracted:', meetingInfo);
      
      // Set up event listeners
      this.setupMeetingEventListeners();
      
      // Join the meeting
      await this.currentMeeting.join({
        receiveTranscription: false,
        receiveAudio: true,
        receiveVideo: false
      });
      
      // Wait for join to complete
      await this.waitForJoinComplete();
      
      this.isInMeeting = true;
      this.meetingData = meetingInfo;
      
      logger.info('Successfully joined meeting');
      
      // Register meeting with backend
      const backendMeetingId = await this.registerMeetingWithBackend(meetingInfo);
      this.meetingData.backendMeetingId = backendMeetingId;
      
      // Set up audio processing
      await this.setupAudioProcessing(backendMeetingId);
      
      // Fetch and send attendee information
      await this.fetchAndSendAttendees();
      
      // Announce bot presence (optional)
      await this.announceBotPresence();
      
      return {
        webexMeetingId: this.currentMeeting.id,
        backendMeetingId: backendMeetingId,
        ...meetingInfo
      };
      
    } catch (error) {
      logger.error('Failed to join meeting:', error);
      throw error;
    }
  }

  /**
   * Set up meeting event listeners
   */
  setupMeetingEventListeners() {
    this.currentMeeting.on('self:unlocked', () => {
      logger.info('Bot successfully unlocked and joined the meeting');
    });
    
    this.currentMeeting.on('media:ready', async ({ type, stream }) => {
      logger.info(`Media ready: ${type}`);
      
      if (type === 'remoteAudio' && stream) {
        logger.info('Remote audio stream available, starting audio processing');
        await this.startAudioCapture(stream);
      }
    });
    
    this.currentMeeting.on('members:update', (event) => {
      logger.info('Meeting members updated:', event.type);
      // Could fetch updated attendee list here
    });
    
    this.currentMeeting.on('meeting:left', () => {
      logger.info('Bot has left the meeting');
      this.handleMeetingLeft();
    });
    
    this.currentMeeting.on('error', (error) => {
      logger.error('Meeting error:', error);
    });
  }

  /**
   * Wait for join to complete
   */
  waitForJoinComplete() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Meeting join timeout'));
      }, 30000);
      
      const checkJoinStatus = () => {
        if (this.currentMeeting.members.selfId) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkJoinStatus, 1000);
        }
      };
      
      checkJoinStatus();
    });
  }

  /**
   * Register meeting with backend API
   */
  async registerMeetingWithBackend(meetingInfo) {
    try {
      logger.info('Registering meeting with backend...');
      
      const response = await axios.post(
        `${config.backend.apiUrl}/api/v1/bot/join`,
        {
          webex_meeting_id: meetingInfo.webexMeetingId,
          title: meetingInfo.title,
          host_email: meetingInfo.hostEmail
        },
        {
          headers: {
            'Authorization': `Bearer ${config.bot.serviceToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const backendMeetingId = response.data.meeting_id;
      logger.info(`Meeting registered with backend: ${backendMeetingId}`);
      
      return backendMeetingId;
      
    } catch (error) {
      logger.error('Failed to register meeting with backend:', error);
      throw error;
    }
  }

  /**
   * Set up audio processing
   */
  async setupAudioProcessing(meetingId) {
    try {
      logger.info('Setting up audio processing...');
      
      // Initialize WebSocket connection to backend
      this.audioWebSocket = new AudioWebSocketClient(meetingId);
      await this.audioWebSocket.connect();
      
      // Initialize audio processor
      this.audioProcessor = new AudioProcessor(this.audioWebSocket);
      
      logger.info('Audio processing setup complete');
      
    } catch (error) {
      logger.error('Failed to setup audio processing:', error);
      throw error;
    }
  }

  /**
   * Start capturing and processing audio
   */
  async startAudioCapture(mediaStream) {
    try {
      if (!this.audioProcessor) {
        logger.warn('Audio processor not initialized, skipping audio capture');
        return;
      }
      
      logger.info('Starting audio capture...');
      await this.audioProcessor.startProcessing(mediaStream);
      logger.info('Audio capture started successfully');
      
    } catch (error) {
      logger.error('Failed to start audio capture:', error);
    }
  }

  /**
   * Fetch attendees and send to backend
   */
  async fetchAndSendAttendees() {
    try {
      logger.info('Fetching meeting attendees...');
      
      // Get attendees using REST API
      const attendees = await this.attendeesAPI.getComprehensiveAttendeeList(
        this.currentMeeting.id
      );
      
      logger.info(`Found ${attendees.length} attendees with emails`);
      
      // Send attendees to backend (could implement this endpoint)
      // For now, just log the attendees
      attendees.forEach(attendee => {
        logger.info(`Attendee: ${attendee.displayName} (${attendee.email})`);
      });
      
      return attendees;
      
    } catch (error) {
      logger.error('Failed to fetch attendees:', error);
      // Don't throw - attendees are optional for basic functionality
      return [];
    }
  }

  /**
   * Announce bot presence with TTS (optional)
   */
  async announceBotPresence() {
    try {
      // For now, just log - TTS implementation would go here
      logger.info('Bot announcement: "AI Notetaker has joined the meeting"');
      
      // TODO: Implement TTS announcement
      // 1. Generate TTS audio using service
      // 2. Create MediaStream from audio
      // 3. Add to meeting audio
      
    } catch (error) {
      logger.error('Failed to announce bot presence:', error);
      // Don't throw - announcement is optional
    }
  }

  /**
   * Leave the meeting
   */
  async leaveMeeting() {
    try {
      logger.info('Leaving meeting...');
      
      // Stop audio processing
      if (this.audioProcessor) {
        this.audioProcessor.stopProcessing();
        this.audioProcessor = null;
      }
      
      // Close WebSocket connection
      if (this.audioWebSocket) {
        this.audioWebSocket.close();
        this.audioWebSocket = null;
      }
      
      // Leave Webex meeting
      if (this.currentMeeting) {
        await this.currentMeeting.leave();
      }
      
      // Notify backend that bot is leaving
      await this.notifyBackendMeetingEnd();
      
      this.handleMeetingLeft();
      
      logger.info('Successfully left meeting');
      
    } catch (error) {
      logger.error('Error leaving meeting:', error);
      throw error;
    }
  }

  /**
   * Notify backend that meeting has ended
   */
  async notifyBackendMeetingEnd() {
    try {
      if (!this.meetingData?.backendMeetingId) {
        logger.warn('No backend meeting ID available for cleanup');
        return;
      }
      
      logger.info('Notifying backend of meeting end...');
      
      await axios.post(
        `${config.backend.apiUrl}/api/v1/bot/leave`,
        {
          meeting_id: this.meetingData.backendMeetingId
        },
        {
          headers: {
            'Authorization': `Bearer ${config.bot.serviceToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      logger.info('Backend notified of meeting end');
      
    } catch (error) {
      logger.error('Failed to notify backend of meeting end:', error);
      // Don't throw - this is cleanup
    }
  }

  /**
   * Handle meeting left cleanup
   */
  handleMeetingLeft() {
    this.isInMeeting = false;
    this.currentMeeting = null;
    this.meetingData = null;
    
    if (this.audioProcessor) {
      this.audioProcessor.stopProcessing();
      this.audioProcessor = null;
    }
    
    if (this.audioWebSocket) {
      this.audioWebSocket.close();
      this.audioWebSocket = null;
    }
  }

  /**
   * Get current meeting status
   */
  getMeetingStatus() {
    return {
      isInMeeting: this.isInMeeting,
      meetingData: this.meetingData,
      isAudioProcessing: this.audioProcessor?.isProcessing || false,
      isWebSocketConnected: this.audioWebSocket?.isReady() || false
    };
  }
}

module.exports = { WebexMeetingBot };
