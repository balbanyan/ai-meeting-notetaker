/**
 * Headless Webex Client for Puppeteer
 * Uses shared config and audio processor, implements Webex logic directly
 * Optimized for headless browser automation
 */

const { BackendClient } = require('../shared/api/http-client');
const { AudioProcessor } = require('../shared/audio/processor');
const { config } = require('../shared/config');
const { createLogger, testBackend } = require('../shared/utils');
// JWT no longer needed - using bot token

class PuppeteerWebexClient {
  constructor(page) {
    this.page = page;
    this.meetingId = null;
    this.hostEmail = null;
    this.isInMeeting = false;
    
    // Use shared components
    this.backendClient = new BackendClient();
    this.audioProcessor = null; // Will be created when we have meeting details
    this.logger = createLogger('Headless');
    // No longer need JWT generator - using bot token
  }

  // ============================================================================
  // BOT TOKEN AUTHENTICATION (replaces JWT)
  // ============================================================================

  // ============================================================================
  // BACKEND CONNECTION TEST
  // ============================================================================

  async testBackendConnection() {
    const success = await testBackend(this.backendClient, this.logger);
    if (!success) {
      this.logger('⚠️ Backend connection failed, proceeding anyway', 'warn');
    }
  }

  // ============================================================================
  // MAIN WORKFLOW
  // ============================================================================

  async joinMeeting(meetingUrl) {
    try {
      this.logger('🚀 Starting headless meeting join...', 'info');
      this.meetingId = meetingUrl;
      
      // Test backend connection
      await this.testBackendConnection();

      // Set up browser environment
      await this.setupBrowserEnvironment();
      
      // Initialize Webex and join meeting
      await this.initializeWebexAndJoin(meetingUrl);
      
      // Set up audio processing
      await this.initializeAudioProcessor();
      await this.setupAudioProcessing();
      
      // Start monitoring for browser close requests (following docs pattern)
      this.startBrowserCloseMonitoring();

      this.logger('🎉 Meeting joined successfully with headless client!', 'success');
      this.isInMeeting = true;

      return {
        success: true,
        meetingId: this.meetingId,
        message: 'Meeting joined successfully'
      };

    } catch (error) {
      this.logger(`❌ Failed to join meeting: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message
      };
    }
  }

  async setupBrowserEnvironment() {
    this.logger('🔧 Setting up browser environment...', 'info');
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Headless Webex Client</title>
      </head>
      <body>
        <div id="status">Initializing...</div>
        <audio id="remote-view-audio" autoplay style="display: none;"></audio>
        <script>
          console.log('📄 Browser environment ready');
          window.audioChunkReady = null;
          window.webexAudioStream = null;
          window.meetingAudioContext = null;
        </script>
      </body>
      </html>
    `;
    
    await this.page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    
    // Load Webex SDK
    this.logger('⏳ Loading Webex SDK...', 'info');
    await this.page.addScriptTag({ 
      url: 'https://unpkg.com/webex@3.8.1/umd/webex.min.js',
      timeout: 15000 
    });
    
    // Wait for Webex to be available
    await this.page.waitForFunction('typeof window.Webex !== "undefined"', { timeout: 15000 });
    
    // Grant microphone permissions
    await this.grantMicrophonePermissions();
    
    this.logger('✅ Browser environment set up', 'success');
  }

  async grantMicrophonePermissions() {
    const context = this.page.browser().defaultBrowserContext();
    try {
      await context.overridePermissions('https://binaries.webex.com', ['microphone', 'camera']);
      this.logger('🎤 Microphone permissions granted for Webex domains', 'info');
    } catch (error) {
      this.logger('⚠️ Permission grant failed (will rely on browser flags): ' + error.message, 'warn');
    }
  }

  async initializeWebexAndJoin(meetingUrl) {
    this.logger('🔧 Initializing Webex SDK in browser...', 'info');
    
    const result = await this.page.evaluate(async (meetingUrl, config) => {
      try {
        console.log('🔧 Starting Webex SDK initialization...');
        
        // Wait for Webex to be available
        while (typeof window.Webex === 'undefined') {
          console.log('⏳ Waiting for Webex SDK...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Initialize Webex SDK with bot access token (official method)
        const webex = window.Webex.init({
          credentials: {
            access_token: config.webex.botAccessToken
          },
          config: {
            logger: { level: 'info' },
            meetings: { enableRtx: true }
          }
        });

        console.log('✅ Webex SDK initialized with bot access token');
        
        // Simple browser close flag (following docs pattern)
        window.shouldCloseBrowser = false;
        
        // Validate bot authentication before registering for meetings
        console.log('🔐 Validating bot authentication...');
        try {
            const botInfo = await webex.people.get('me');
            console.log(`✅ Bot authenticated: ${botInfo.displayName}`);
            
            // Register with Webex Cloud
            console.log('📱 Registering with Webex Cloud...');
            await webex.meetings.register()
              .catch((err) => {
                console.error('Registration error:', err);
                throw err;
              });
        } catch (err) {
            console.error(`❌ Bot authentication failed: ${err.message}`);
            throw err;
        }
        
        console.log('✅ Webex SDK initialized successfully');

        // Create meeting
        console.log('🏗️ Creating meeting object...');
        const meeting = await webex.meetings.create(meetingUrl);
        console.log('✅ Meeting object created');

        // Set up event listeners
        meeting.on('error', (error) => {
          console.error('❌ Meeting error:', error);
        });

        meeting.on('media:ready', async (media) => {
          console.log(`🎵 Meeting media ready: ${media.type}`);
          
          if (media.type === 'remoteAudio' && media.stream) {
            console.log('🎧 Remote audio stream detected, using official SDK approach...');
            
            // Store the audio stream globally
            window.webexAudioStream = media.stream;
            
            // Create or recreate audio element (following working webex-client pattern)
            let remoteAudioElement = document.getElementById('remote-view-audio');
            if (remoteAudioElement && remoteAudioElement._wasConnectedToSource) {
              remoteAudioElement.remove();
              remoteAudioElement = null;
            }
            
            if (!remoteAudioElement) {
              remoteAudioElement = document.createElement('audio');
              remoteAudioElement.id = 'remote-view-audio';
              remoteAudioElement.autoplay = true;
              remoteAudioElement.style.display = 'none';
              document.body.appendChild(remoteAudioElement);
            }

            // Assign stream for playback (documentation-compliant)
            remoteAudioElement.srcObject = media.stream;
            
            remoteAudioElement.onloadedmetadata = async () => {
              console.log('🎵 Audio element loaded, starting capture...');
              
              try {
                // Setup audio contexts (following working webex-client patterns)
                if (window.meetingAudioContext) {
                  window.meetingAudioContext.close();
                }

                // Playback context
                window.meetingAudioContext = new AudioContext();
                const source = window.meetingAudioContext.createMediaElementSource(remoteAudioElement);
                remoteAudioElement._wasConnectedToSource = true;
                source.connect(window.meetingAudioContext.destination);

                // Capture context for processing
                const captureContext = new AudioContext({ sampleRate: config.audio.sampleRate });
                const streamSource = captureContext.createMediaStreamSource(media.stream);
                const analyser = captureContext.createAnalyser();
                analyser.fftSize = 2048;
                
                streamSource.connect(analyser);
                
                // Start audio chunk capture (following working webex-client pattern)
                let audioBuffer = [];
                const targetSamples = config.audio.sampleRate * (config.audio.chunkDurationMs / 1000);
                
                const captureInterval = setInterval(() => {
                  const bufferLength = analyser.frequencyBinCount;
                  const dataArray = new Float32Array(bufferLength);
                  analyser.getFloatTimeDomainData(dataArray);
                  
                  audioBuffer.push(...dataArray);
                  
                  if (audioBuffer.length >= targetSamples) {
                    const chunk = audioBuffer.slice(0, targetSamples);
                    audioBuffer = audioBuffer.slice(targetSamples);
                    window.audioChunkReady = chunk;
                  }
                }, 100);
                
                // Store references for cleanup
                window.audioInterval = captureInterval;
                window.captureContext = captureContext;
                console.log('✅ Audio capture started successfully');
                
              } catch (error) {
                console.error('❌ Failed to set up audio capture:', error);
              }
            };
          }
        });

        meeting.on('media:stopped', (media) => {
          console.log(`🔇 Meeting media stopped: ${media.type}`);
          if (media.type === 'remoteAudio') {
            window.webexAudioStream = null;
            if (window.audioInterval) {
              clearInterval(window.audioInterval);
              window.audioInterval = null;
            }
            if (window.meetingAudioContext) {
              window.meetingAudioContext.close();
              window.meetingAudioContext = null;
            }
            if (window.captureContext) {
              window.captureContext.close();
              window.captureContext = null;
            }
            // Clean up audio element
            const remoteAudioElement = document.getElementById('remote-view-audio');
            if (remoteAudioElement) {
              remoteAudioElement.srcObject = null;
              remoteAudioElement.remove();
            }
          }
        });

        // Simple meeting events (following docs pattern)
        meeting.on('meeting:left', () => {
          console.log('👋 Meeting left');
        });

        meeting.on('meeting:ended', () => {
          console.log('🔚 Meeting ended');
        });
        
        meeting.on('meeting:inactive', () => {
          console.log('💤 Meeting inactive');
        });

        // Handle media events (following docs pattern)
        let mediaStreamCount = 0;
        let stoppedStreamCount = 0;
        
        meeting.on('media:ready', (media) => {
          mediaStreamCount++;
          console.log(`🎵 Media ready: ${media.type} (total: ${mediaStreamCount})`);
        });

        meeting.on('media:stopped', (media) => {
          stoppedStreamCount++;
          console.log(`🔇 Media stopped: ${media.type} (stopped: ${stoppedStreamCount}/${mediaStreamCount})`);
          
          // Clean up media elements (following docs)
          if (media.type === 'remoteAudio') {
            let remoteAudioElement = document.getElementById('remote-view-audio');
            if (remoteAudioElement) {
              remoteAudioElement.srcObject = null;
              remoteAudioElement.remove();
            }
          }
          
          // If all media streams stopped, likely meeting ended
          if (stoppedStreamCount >= mediaStreamCount && mediaStreamCount > 0) {
            console.log('📡 All media streams stopped - meeting likely ended');
            window.shouldCloseBrowser = true;
          }
        });

        // Join meeting
        console.log('🎯 Joining meeting...');
        await meeting.join();
        console.log('✅ Successfully joined meeting');

        // Add media
        console.log('🎧 Adding media...');
        await meeting.addMedia({ mediaOptions: { receiveAudio: true } });
        console.log('✅ Media added successfully');

        return { success: true, meetingId: meetingUrl };

      } catch (error) {
        console.error('❌ Browser initialization failed:', error);
        return { success: false, error: error.message };
      }
    }, meetingUrl, config);

    if (!result.success) {
      throw new Error(`Browser initialization failed: ${result.error}`);
    }

    this.logger('✅ Webex initialized and meeting joined in browser', 'success');
    return result;
  }

  /**
   * Monitor browser for close requests (critical for GCP to prevent hanging browsers)
   */
  startBrowserCloseMonitoring() {
    this.closeMonitorInterval = setInterval(async () => {
      try {
        const shouldClose = await this.page.evaluate(() => window.shouldCloseBrowser);
        if (shouldClose) {
          this.logger(`🚪 Browser close requested - meeting ended`, 'warn');
          await this.cleanup();
          return;
        }
      } catch (error) {
        // Page might be closed, stop monitoring
        this.logger('⚠️ Browser monitoring stopped (page closed)', 'info');
        clearInterval(this.closeMonitorInterval);
      }
    }, 1000); // Check every second
  }

  /**
   * Cleanup browser and resources (critical for GCP)
   */
  async cleanup() {
    this.logger('🧹 Cleaning up headless browser resources...', 'info');
    
    // Stop monitoring
    if (this.closeMonitorInterval) {
      clearInterval(this.closeMonitorInterval);
    }
    
    // Stop audio processing
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
    }
    
    // Close page and browser
    try {
      if (this.page) {
        await this.page.close();
        this.logger('✅ Browser page closed', 'success');
      }
    } catch (error) {
      this.logger(`⚠️ Error closing page: ${error.message}`, 'warn');
    }
    
    this.logger('✅ Headless browser cleanup completed', 'success');
  }

  /**
   * Initialize AudioProcessor with meeting details and backend chunk count
   */
  async initializeAudioProcessor() {
    this.logger('🔧 Initializing AudioProcessor with meeting details...', 'info');
    
    // Create AudioProcessor with proper parameters
    this.audioProcessor = new AudioProcessor(this.meetingId, this.hostEmail, this.backendClient);
    
    // Initialize chunk count from backend to continue sequence
    await this.audioProcessor.initializeChunkCount();
    
    this.logger(`✅ AudioProcessor initialized - Starting from chunk #${this.audioProcessor.chunkCount + 1}`, 'success');
  }

  async setupAudioProcessing() {
    this.logger('🎵 Setting up audio processing loop...', 'info');

    const audioInterval = setInterval(async () => {
      if (!this.isInMeeting) {
        clearInterval(audioInterval);
        return;
      }

      try {
        const audioChunk = await this.page.evaluate(() => {
          if (window.audioChunkReady && window.audioChunkReady.length > 0) {
            const chunk = window.audioChunkReady;
            window.audioChunkReady = null;
            return Array.from(chunk);
          }
          return null;
        });

        if (audioChunk && audioChunk.length > 0) {
          // Process through shared audio processor
          await this.processAudioChunk(audioChunk);
        }
      } catch (error) {
        this.logger(`❌ Audio processing error: ${error.message}`, 'error');
      }
    }, 500);

    this.audioInterval = audioInterval;
    this.logger('✅ Audio processing loop started', 'success');
  }

  async processAudioChunk(audioChunk) {
    this.audioProcessor.chunkCount++;
    const chunkId = this.audioProcessor.chunkCount;
    
    // Use shared audio processor for processing
    this.logger(`🔄 Processing audio chunk #${chunkId}`, 'info');
    this.logger(`📊 Buffer: ${audioChunk.length} samples, Duration: ~${config.audio.chunkDurationMs/1000}s`, 'info');
    
    // Use shared audio processor for conversion and sending
    const bufferArray = new Float32Array(audioChunk);
    const audioData = this.audioProcessor.convertToWAV([bufferArray]);
    
    try {
      await this.backendClient.sendAudioChunk(this.meetingId, chunkId, audioData, this.hostEmail);
      this.logger(`✅ Audio chunk sent successfully - Status: saved`, 'success');
    } catch (error) {
      this.logger(`❌ Failed to send audio chunk: ${error.message}`, 'error');
    }
  }

  async leaveMeeting() {
    this.logger('👋 Leaving meeting...', 'info');
    this.isInMeeting = false;
    
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
    }

    try {
      await this.page.evaluate(() => {
        if (window.audioInterval) {
          clearInterval(window.audioInterval);
          window.audioInterval = null;
        }
        if (window.meetingAudioContext) {
          window.meetingAudioContext.close();
          window.meetingAudioContext = null;
        }
        if (window.captureContext) {
          window.captureContext.close();
          window.captureContext = null;
        }
        // Clean up audio element
        const remoteAudioElement = document.getElementById('remote-view-audio');
        if (remoteAudioElement) {
          remoteAudioElement.srcObject = null;
          remoteAudioElement.remove();
        }
        window.webexAudioStream = null;
        window.audioChunkReady = null;
      });
    } catch (error) {
      this.logger(`❌ Cleanup error: ${error.message}`, 'error');
    }

    this.logger('✅ Meeting left successfully', 'success');
  }
}

module.exports = { PuppeteerWebexClient };
