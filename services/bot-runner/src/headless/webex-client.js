/**
 * Headless Webex Client for Puppeteer
 * Uses shared config and audio processor, implements Webex logic directly
 * Optimized for headless browser automation
 */

const { BackendClient } = require('../shared/api/http-client');
const { AudioProcessor } = require('../shared/audio/processor');
const { config } = require('../shared/config');
const { generateUUID, createLogger, testBackend } = require('../shared/utils');
const { JWTGenerator } = require('../shared/webex/jwt');

class PuppeteerWebexClient {
  constructor(page) {
    this.page = page;
    this.meetingId = null;
    this.hostEmail = null;
    this.isInMeeting = false;
    
    // Use shared components
    this.backendClient = new BackendClient();
    this.audioProcessor = new AudioProcessor(this.backendClient);
    this.logger = createLogger('Headless');
    this.jwtGenerator = new JWTGenerator(config, this.logger);
  }

  // ============================================================================
  // JWT GENERATION (using shared component)
  // ============================================================================

  buildJWT() {
    return this.jwtGenerator.buildJWT();
  }

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
      await this.setupAudioProcessing();

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

    const jwtToken = this.buildJWT();
    
    const result = await this.page.evaluate(async (meetingUrl, jwtToken, config) => {
      try {
        console.log('🔧 Starting Webex SDK initialization...');
        
        // Wait for Webex to be available
        while (typeof window.Webex === 'undefined') {
          console.log('⏳ Waiting for Webex SDK...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Initialize Webex
        const webex = window.Webex.init({
          config: {
            logger: { level: 'info' },
            meetings: { enableRtx: true }
          }
        });

        console.log('🔐 Authenticating with JWT...');
        await webex.authorization.requestAccessTokenFromJwt({ jwt: jwtToken });
        
        console.log('📱 Registering device...');
        await webex.meetings.register();
        
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

        meeting.on('meeting:left', () => {
          console.log('👋 Meeting left');
        });

        meeting.on('meeting:ended', () => {
          console.log('🔚 Meeting ended');
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
    }, meetingUrl, jwtToken, config);

    if (!result.success) {
      throw new Error(`Browser initialization failed: ${result.error}`);
    }

    this.logger('✅ Webex initialized and meeting joined in browser', 'success');
    return result;
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
    const chunkId = generateUUID();
    
    // Use shared audio processor for processing
    this.audioProcessor.chunkCount++;
    this.logger(`🔄 Processing audio chunk #${this.audioProcessor.chunkCount}`, 'info');
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
