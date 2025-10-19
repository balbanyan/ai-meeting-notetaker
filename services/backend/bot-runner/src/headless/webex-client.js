/**
 * Headless Webex Client for Puppeteer
 * Uses shared config and audio processor, implements Webex logic directly
 * Optimized for headless browser automation
 */

const { BackendClient } = require('../shared/api/http-client');
const { AudioProcessor } = require('../shared/audio/processor');
const { config } = require('../shared/config');
const { createLogger, testBackend } = require('../shared/utils');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class PuppeteerWebexClient {
  constructor(page) {
    this.page = page;
    this.meetingUrl = null;
    this.meetingUuid = null;  // Internal meeting UUID from backend
    this.webexMeetingId = null;  // Webex's meeting ID
    this.hostEmail = null;
    this.isInMeeting = false;
    
    // Use shared components
    this.backendClient = new BackendClient();
    this.audioProcessor = null; // Will be created when we have meeting details
    this.logger = createLogger('Headless');
  }


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
      this.meetingUrl = meetingUrl;
      
      // Test backend connection
      await this.testBackendConnection();

      // Fetch meeting metadata from Webex and register with backend
      await this.fetchAndRegisterMeeting(meetingUrl);

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
        meetingId: this.meetingUuid,
        webexMeetingId: this.webexMeetingId,
        hostEmail: this.hostEmail,
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

  /**
   * Fetch meeting metadata and register with backend
   * Backend handles all Webex API calls
   */
  async fetchAndRegisterMeeting(meetingUrl) {
    this.logger('📋 Fetching and registering meeting via backend...', 'info');
    
    // Backend does everything: fetch from Webex APIs + register in DB
    const registration = await this.backendClient.fetchAndRegisterMeeting(meetingUrl);
    
    // Store response data
    this.meetingUuid = registration.meeting_uuid;
    this.webexMeetingId = registration.webex_meeting_id;
    this.hostEmail = registration.host_email;
    
    this.logger(`✅ Meeting registered - UUID: ${this.meetingUuid}`, 'success');
    
    if (registration.last_chunk_id > 0) {
      this.logger(`📊 Continuing from chunk #${registration.last_chunk_id + 1}`, 'info');
    }
    
    return registration;
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
            console.log('🎧 Remote audio stream detected, using MediaRecorder approach...');
            
            // Store the audio stream globally
            window.webexAudioStream = media.stream;
            
            // Create audio element for SDK compliance
            let remoteAudioElement = document.getElementById('remote-view-audio');
            if (!remoteAudioElement) {
              remoteAudioElement = document.createElement('audio');
              remoteAudioElement.id = 'remote-view-audio';
              remoteAudioElement.autoplay = true;
              remoteAudioElement.style.display = 'none';
              document.body.appendChild(remoteAudioElement);
            }

            // Assign stream for SDK compliance and playback
            remoteAudioElement.srcObject = media.stream;
            
            remoteAudioElement.onloadedmetadata = async () => {
              console.log('🎵 Audio element loaded, starting MediaRecorder capture...');
              
              try {
                // Clean up any existing MediaRecorder
                if (window.mediaRecorder && window.mediaRecorder.state !== 'inactive') {
                  window.mediaRecorder.stop();
                }

                // Create MediaRecorder for clean audio capture
                const mediaRecorder = new MediaRecorder(media.stream, {
                  mimeType: 'audio/webm;codecs=opus',
                  audioBitsPerSecond: 128000
                });

                let webmChunks = [];
                let chunkStartTime = Date.now();
                let isRecording = true;

                mediaRecorder.ondataavailable = async (event) => {
                  if (event.data.size > 0) {
                    console.log(`📦 MediaRecorder fragment received: ${event.data.size} bytes`);
                    webmChunks.push(event.data);
                  }
                };

                mediaRecorder.onstop = async () => {
                  console.log('🔇 MediaRecorder stopped, processing complete WebM...');
                  
                  if (webmChunks.length > 0) {
                    try {
                      // Combine all WebM fragments into complete file
                      const completeWebM = new Blob(webmChunks, { type: 'audio/webm;codecs=opus' });
                      const arrayBuffer = await completeWebM.arrayBuffer();
                      const uint8Array = new Uint8Array(arrayBuffer);
                      
                      console.log(`✅ Complete WebM created: ${completeWebM.size} bytes from ${webmChunks.length} fragments`);
                      
                      // Store complete WebM for Node.js processing
                      window.audioChunkReady = {
                        data: Array.from(uint8Array),
                        timestamp: chunkStartTime,
                        format: 'webm',
                        mimeType: completeWebM.type,
                        size: completeWebM.size
                      };
                      
                      // Reset for next chunk
                      webmChunks = [];
                      chunkStartTime = Date.now();
                      
                      // Restart recording if still active
                      if (isRecording && window.mediaRecorder && window.mediaRecorder.state === 'inactive') {
                        setTimeout(() => {
                          if (isRecording) {
                            console.log('🔄 Restarting MediaRecorder for next chunk...');
                            window.mediaRecorder.start();
                          }
                        }, 100);
                      }
                      
                    } catch (error) {
                      console.error('❌ Failed to process complete WebM:', error);
                    }
                  }
                };

                mediaRecorder.onerror = (error) => {
                  console.error('❌ MediaRecorder error:', error);
                };

                // Start recording and set up chunk timing
                const chunkDurationMs = config.audio.chunkDurationMs;
                mediaRecorder.start();
                
                // Stop and restart every chunkDurationMs to create complete WebM files
                const chunkInterval = setInterval(() => {
                  if (isRecording && mediaRecorder.state === 'recording') {
                    console.log(`⏱️ Creating ${chunkDurationMs/1000}s WebM chunk...`);
                    mediaRecorder.stop();
                  }
                }, chunkDurationMs);
                
                // Clean up function
                window.stopMediaRecorder = () => {
                  isRecording = false;
                  clearInterval(chunkInterval);
                  if (mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                  }
                };
                
                // Store references for cleanup
                window.mediaRecorder = mediaRecorder;
                
                console.log(`✅ MediaRecorder started - capturing ${chunkDurationMs/1000}s chunks`);
                
              } catch (error) {
                console.error('❌ Failed to set up MediaRecorder:', error);
              }
            };
          }
        });

        meeting.on('media:stopped', (media) => {
          console.log(`🔇 Meeting media stopped: ${media.type}`);
          if (media.type === 'remoteAudio') {
            window.webexAudioStream = null;
            
            // Stop and clean up MediaRecorder
            if (window.stopMediaRecorder) {
              window.stopMediaRecorder();
              window.stopMediaRecorder = null;
            }
            if (window.mediaRecorder) {
              window.mediaRecorder = null;
            }
            
            // Clean up audio element
            const remoteAudioElement = document.getElementById('remote-view-audio');
            if (remoteAudioElement) {
              remoteAudioElement.srcObject = null;
              remoteAudioElement.remove();
            }
            
            // Clear chunk data
            window.audioChunkReady = null;
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
        
        // Count media streams for meeting end detection
        meeting.on('media:ready', (media) => {
          mediaStreamCount++;
          console.log(`🎵 Media ready: ${media.type} (total: ${mediaStreamCount})`);
        });

        meeting.on('media:stopped', (media) => {
          stoppedStreamCount++;
          console.log(`🔇 Media stopped: ${media.type} (stopped: ${stoppedStreamCount}/${mediaStreamCount})`);
          
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
    
    // Update meeting status to inactive
    try {
      if (this.meetingUuid) {
        await this.backendClient.updateMeetingStatus(this.meetingUuid, {
          is_active: false,
          actual_leave_time: new Date().toISOString()
        });
        this.logger('✅ Meeting status updated to inactive', 'success');
      }
    } catch (error) {
      this.logger(`⚠️ Error updating meeting status: ${error.message}`, 'warn');
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
   * Initialize AudioProcessor with meeting UUID
   */
  async initializeAudioProcessor() {
    this.logger('🔧 Initializing AudioProcessor with meeting UUID...', 'info');
    
    // Create AudioProcessor with meeting UUID
    this.audioProcessor = new AudioProcessor(this.meetingUuid, this.hostEmail, this.backendClient);
    
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
          if (window.audioChunkReady && window.audioChunkReady.data) {
            const chunk = window.audioChunkReady;
            window.audioChunkReady = null;
            return chunk;
          }
          return null;
        });

        if (audioChunk && audioChunk.data && audioChunk.data.length > 0) {
          // Process WebM chunk from MediaRecorder
          await this.processMediaRecorderChunk(audioChunk);
        }
      } catch (error) {
        this.logger(`❌ Audio processing error: ${error.message}`, 'error');
      }
    }, 500);

    this.audioInterval = audioInterval;
    this.logger('✅ Audio processing loop started', 'success');
  }

  async processMediaRecorderChunk(audioChunk) {
    this.audioProcessor.chunkCount++;
    const chunkId = this.audioProcessor.chunkCount;
    
    // Process MediaRecorder WebM chunk
    this.logger(`🔄 Processing MediaRecorder chunk #${chunkId}`, 'info');
    this.logger(`📊 WebM chunk: ${audioChunk.size} bytes, Format: ${audioChunk.format}, MIME: ${audioChunk.mimeType}`, 'info');
    
    try {
      // Convert array back to Buffer
      const webmBuffer = Buffer.from(audioChunk.data);
      
      // Convert WebM to WAV using ffmpeg
      this.logger(`🔄 Converting WebM to WAV...`, 'info');
      const wavBuffer = await this.convertWebmToWav(webmBuffer);
      this.logger(`✅ Conversion complete: ${webmBuffer.length} bytes WebM → ${wavBuffer.length} bytes WAV`, 'success');
      
      // Send WAV chunk to backend using meeting UUID
      await this.backendClient.sendAudioChunk(this.meetingUuid, chunkId, wavBuffer, this.hostEmail);
      this.logger(`✅ WAV chunk sent successfully - Status: saved`, 'success');
    } catch (error) {
      this.logger(`❌ Failed to process MediaRecorder chunk: ${error.message}`, 'error');
    }
  }

  /**
   * Convert WebM buffer to WAV using ffmpeg (using temp files for reliability)
   */
  async convertWebmToWav(webmBuffer) {
    const tempDir = os.tmpdir();
    const inputFile = path.join(tempDir, `webm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webm`);
    const outputFile = path.join(tempDir, `wav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`);
    
    try {
      // Write WebM buffer to temporary file
      await fs.writeFile(inputFile, webmBuffer);
      
      // Convert using ffmpeg with file paths (more reliable than streams)
      await new Promise((resolve, reject) => {
        ffmpeg(inputFile)
          .audioCodec('pcm_s16le')  // 16-bit PCM
          .audioChannels(1)        // Mono
          .audioFrequency(16000)   // 16kHz sample rate
          .format('wav')
          .output(outputFile)
          .on('error', (err) => {
            this.logger(`❌ FFmpeg conversion error: ${err.message}`, 'error');
            reject(new Error(`FFmpeg conversion failed: ${err.message}`));
          })
          .on('end', () => {
            this.logger(`🎵 FFmpeg conversion completed: ${inputFile} → ${outputFile}`, 'info');
            resolve();
          })
          .run();
      });
      
      // Read the converted WAV file
      const wavBuffer = await fs.readFile(outputFile);
      
      // Clean up temporary files
      await fs.unlink(inputFile).catch(() => {}); // Ignore cleanup errors
      await fs.unlink(outputFile).catch(() => {});
      
      return wavBuffer;
      
    } catch (error) {
      // Clean up on error
      await fs.unlink(inputFile).catch(() => {});
      await fs.unlink(outputFile).catch(() => {});
      throw error;
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
        // Stop and clean up MediaRecorder
        if (window.stopMediaRecorder) {
          window.stopMediaRecorder();
          window.stopMediaRecorder = null;
        }
        if (window.mediaRecorder) {
          window.mediaRecorder = null;
        }
        
        // Clean up audio element
        const remoteAudioElement = document.getElementById('remote-view-audio');
        if (remoteAudioElement) {
          remoteAudioElement.srcObject = null;
          remoteAudioElement.remove();
        }
        
        // Clear global variables
        window.webexAudioStream = null;
        window.audioChunkReady = null;
      });
      
      // Update meeting status in backend
      if (this.meetingUuid) {
        await this.backendClient.updateMeetingStatus(this.meetingUuid, {
          is_active: false,
          actual_leave_time: new Date().toISOString()
        });
        this.logger('✅ Meeting status updated to inactive', 'success');
      }
    } catch (error) {
      this.logger(`❌ Cleanup error: ${error.message}`, 'error');
    }

    this.logger('✅ Meeting left successfully', 'success');
  }
}

module.exports = { PuppeteerWebexClient };
