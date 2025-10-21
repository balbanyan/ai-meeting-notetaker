/**
 * Headless Multistream Webex Client for Puppeteer
 * Uses shared config and audio processor with multistream support
 * Based on webex-client.js but with multistream events and speaker change detection
 */

const { BackendClient } = require('../shared/api/http-client');
const { AudioProcessor } = require('../shared/audio/processor');
const { config } = require('../shared/config');
const { createLogger, testBackend } = require('../shared/utils');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class MultistreamWebexClient {
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
    this.logger = createLogger('HeadlessMultistream');
    
    // Speaker event processing
    this.speakerEventInterval = null;
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
      this.logger('🚀 Starting headless multistream meeting join...', 'info');
      this.meetingUrl = meetingUrl;
      
      // Test backend connection
      await this.testBackendConnection();

      // Fetch meeting metadata from Webex and register with backend
      await this.fetchAndRegisterMeeting(meetingUrl);

      // Set up browser environment
      await this.setupBrowserEnvironment();
      
      // Initialize Webex with multistream and join meeting
      await this.initializeMultistreamWebexAndJoin(meetingUrl);
      
      // Set up audio processing
      await this.initializeAudioProcessor();
      await this.setupAudioProcessing();
      
      // Set up speaker event processing
      await this.setupSpeakerEventProcessing();
      
      // Start monitoring for browser close requests
      this.startBrowserCloseMonitoring();

      this.logger('🎉 Multistream meeting joined successfully with headless client!', 'success');
      this.isInMeeting = true;

      return {
        success: true,
        meetingId: this.meetingUuid,
        webexMeetingId: this.webexMeetingId,
        hostEmail: this.hostEmail,
        message: 'Multistream meeting joined successfully'
      };

    } catch (error) {
      this.logger(`❌ Failed to join multistream meeting: ${error.message}`, 'error');
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
    this.logger('🔧 Setting up browser environment for multistream...', 'info');
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Headless Multistream Webex Client</title>
      </head>
      <body>
        <div id="status">Initializing multistream...</div>
        <audio id="multistream-remote-audio" autoplay style="display: none;"></audio>
        <script>
          console.log('📄 Multistream browser environment ready');
          window.audioChunkReady = null;
          window.webexAudioStream = null;
          
          // Speaker event processing variables
          window.speakerEvents = [];
          window.currentSpeakerId = null;
          window.speakerStartTime = null;
          window.speakerDebounceTimer = null;
          window.silenceTimer = null;
          
          // Speaker configuration
          window.SPEAKER_CONFIG = {
            debounceThreshold: 3000,      // 3 seconds
            silenceThreshold: 500,        // 0.5 seconds  
            enableDebouncing: true
          };
          
          console.log('🎛️ Speaker Config:', window.SPEAKER_CONFIG);
        </script>
      </body>
      </html>
    `;
    
    await this.page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    
    // Load Webex SDK
    this.logger('⏳ Loading Webex SDK for multistream...', 'info');
    await this.page.addScriptTag({ 
      url: 'https://unpkg.com/webex@3.8.1/umd/webex.min.js',
      timeout: 15000 
    });
    
    // Wait for Webex to be available
    await this.page.waitForFunction('typeof window.Webex !== "undefined"', { timeout: 15000 });
    
    // Grant microphone permissions
    await this.grantMicrophonePermissions();
    
    this.logger('✅ Multistream browser environment set up', 'success');
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

  async initializeMultistreamWebexAndJoin(meetingUrl) {
    this.logger('🔧 Initializing Webex SDK with multistream in browser...', 'info');
    
    const result = await this.page.evaluate(async (meetingUrl, config) => {
      try {
        console.log('🔧 Starting Webex SDK multistream initialization...');
        
        // Wait for Webex to be available
        while (typeof window.Webex === 'undefined') {
          console.log('⏳ Waiting for Webex SDK...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Initialize Webex SDK with bot access token
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
        
        // Browser close flag
        window.shouldCloseBrowser = false;
        
        // Validate bot authentication
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
        
        console.log('✅ Webex SDK initialized successfully for multistream');

        // Create meeting
        console.log('🏗️ Creating meeting object...');
        const meeting = await webex.meetings.create(meetingUrl);
        console.log('✅ Meeting object created');

        // Set up multistream event listeners
        console.log('🎧 Setting up multistream event listeners...');
        
        // Error handling
        meeting.on('error', (error) => {
          console.error('❌ Meeting error:', error);
        });

        // MULTISTREAM EVENT: Remote audio created (replaces media:ready)
        meeting.on('media:remoteAudio:created', (audioMediaGroup) => {
          console.log('🎵 Multistream remote audio created');
          
          // Get remote media from the group
          const remoteMediaArray = audioMediaGroup.getRemoteMedia();
          console.log(`🔍 Received ${remoteMediaArray.length} audio streams`);
          
          if (remoteMediaArray.length > 0) {
            const firstMedia = remoteMediaArray[0]; // Use only first stream
            
            console.log(`🎵 Processing first audio stream: ${firstMedia.id}`);
            console.log(`🔍 Stream state: ${firstMedia.sourceState}`);
            
            if (firstMedia.stream) {
              // Store the audio stream globally
              window.webexAudioStream = firstMedia.stream;
              
              // Create single audio element
              let remoteAudioElement = document.getElementById('multistream-remote-audio');
              if (!remoteAudioElement) {
                remoteAudioElement = document.createElement('audio');
                remoteAudioElement.id = 'multistream-remote-audio';
                remoteAudioElement.autoplay = true;
                remoteAudioElement.style.display = 'none';
                document.body.appendChild(remoteAudioElement);
              }

              // Assign stream for SDK compliance and playback
              remoteAudioElement.srcObject = firstMedia.stream;
              console.log('✅ Audio stream attached to element');
              
              remoteAudioElement.onloadedmetadata = async () => {
                console.log('🎵 Multistream audio element loaded, starting MediaRecorder capture...');
                
                try {
                  // Clean up any existing MediaRecorder
                  if (window.mediaRecorder && window.mediaRecorder.state !== 'inactive') {
                    window.mediaRecorder.stop();
                  }

                  // Create MediaRecorder for clean audio capture (same as legacy)
                  const mediaRecorder = new MediaRecorder(firstMedia.stream, {
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

                  // Start recording and set up chunk timing (same as legacy)
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
            } else {
              console.log('⚠️ No audio stream available in first media');
            }
          } else {
            console.log('⚠️ No remote media received in audio group');
          }
        });

        // MULTISTREAM EVENT: Active speaker changed
        meeting.on('media:activeSpeakerChanged', ({ memberIds }) => {
          console.log(`🗣️ Active speaker changed: ${memberIds ? memberIds.length : 0} speakers`);
          window.handleSpeakerChange(memberIds);
        });
        
        // ADDITIONAL MULTISTREAM EVENTS
        meeting.on('media:remoteAudioSourceCountChanged', ({ numTotalSource, numLiveSources }) => {
          console.log(`🔊 Audio sources changed: ${numLiveSources}/${numTotalSource} live`);
        });
        
        meeting.on('meeting:startedSharingRemote', (data) => {
          console.log(`📺 Screen sharing started by remote participant`);
        });
        
        meeting.on('meeting:stoppedSharingRemote', (data) => {
          console.log(`📺 Screen sharing stopped by remote participant`);
        });

        // Handle media streams stopping
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
            const remoteAudioElement = document.getElementById('multistream-remote-audio');
            if (remoteAudioElement) {
              remoteAudioElement.srcObject = null;
              remoteAudioElement.remove();
            }
            
            // Clear chunk data
            window.audioChunkReady = null;
          }
        });

        // Standard meeting events with cleanup triggers
        meeting.on('meeting:left', () => {
          console.log('👋 Meeting left - triggering cleanup');
          window.shouldCloseBrowser = true;
        });

        meeting.on('meeting:ended', () => {
          console.log('🔚 Meeting ended - triggering cleanup');
          window.shouldCloseBrowser = true;
        });
        
        meeting.on('meeting:inactive', () => {
          console.log('💤 Meeting inactive - triggering cleanup');
          window.shouldCloseBrowser = true;
        });


        // Join meeting with multistream enabled
        console.log('🎯 Joining meeting with multistream...');
        await meeting.join({
          enableMultistream: true  // Enable multistream
        });
        console.log('✅ Successfully joined meeting with multistream enabled');

        // Add media with multistream configuration
        console.log('🎧 Adding media with multistream configuration...');
        await meeting.addMedia({
          mediaOptions: {
            receiveAudio: true,
            receiveVideo: false  // Audio-only focus
          },
          remoteMediaManagerConfig: {
            audio: {
              numOfActiveSpeakerStreams: 1,  // Single audio stream
              numOfScreenShareStreams: 1
            },
            video: {
              preferLiveVideo: false,
              initialLayoutId: 'Single',
              layouts: {
                Single: {
                  activeSpeakerVideoPaneGroups: []  // Empty - no video panes needed
                }
              }
            }
          }
        });
        console.log('✅ Multistream media added successfully');

        // Store meeting reference for speaker processing
        window.currentMeeting = meeting;

        return { success: true, meetingId: meetingUrl };

      } catch (error) {
        console.error('❌ Browser multistream initialization failed:', error);
        return { success: false, error: error.message };
      }
    }, meetingUrl, config);

    if (!result.success) {
      throw new Error(`Browser multistream initialization failed: ${result.error}`);
    }

    this.logger('✅ Webex multistream initialized and meeting joined in browser', 'success');
    return result;
  }

  // ============================================================================
  // SPEAKER EVENT PROCESSING
  // ============================================================================

  async setupSpeakerEventProcessing() {
    this.logger('🗣️ Setting up speaker event processing...', 'info');
    
    // Inject speaker debouncing logic into browser
    await this.page.evaluate(() => {
      // Speaker change handling with debouncing (adapted from Electron)
      window.handleSpeakerChange = function(memberIds) {
        const detectedSpeakerId = (memberIds && memberIds.length > 0) ? memberIds[0] : null;
        
        // Clear any existing silence timer since we got an event
        if (window.silenceTimer) {
          clearTimeout(window.silenceTimer);
          window.silenceTimer = null;
        }
        
        if (!detectedSpeakerId) {
          console.log('🔇 No active speakers detected');
          
          // Start silence timer - only clear current speaker after silence threshold
          if (window.currentSpeakerId) {
            window.silenceTimer = setTimeout(() => {
              console.log(`🤫 Silence threshold reached, clearing current speaker`);
              clearTimeout(window.speakerDebounceTimer);
              window.currentSpeakerId = null;
              window.speakerStartTime = null;
              window.speakerDebounceTimer = null;
            }, window.SPEAKER_CONFIG.silenceThreshold);
          }
          return;
        }
        
        // Check if this is the same speaker as before
        if (detectedSpeakerId === window.currentSpeakerId) {
          return; // Same speaker, no action needed
        }
        
        // New speaker detected
        console.log(`🗣️ Speaker change detected`);
        
        // Clear any existing debounce timer
        if (window.speakerDebounceTimer) {
          clearTimeout(window.speakerDebounceTimer);
        }
        
        // Update current speaker and start time
        window.currentSpeakerId = detectedSpeakerId;
        window.speakerStartTime = new Date();
        
        // Start debounce timer
        window.speakerDebounceTimer = setTimeout(() => {
          window.processSpeakerEvent(window.currentSpeakerId, window.speakerStartTime);
        }, window.SPEAKER_CONFIG.debounceThreshold);
        
        console.log(`⏱️ Debounce timer started: ${window.SPEAKER_CONFIG.debounceThreshold}ms`);
      };
      
      // Process confirmed speaker event
      window.processSpeakerEvent = function(speakerId, startTime) {
        console.log(`✅ Speaker confirmed`);
        
        try {
          // Get member name if available
          let memberName = null;
          try {
            if (window.currentMeeting && window.currentMeeting.members) {
              const member = window.currentMeeting.members.membersCollection.get(speakerId);
              if (member) {
                memberName = member.name || member.displayName;
              }
            }
          } catch (error) {
            console.warn(`⚠️ Could not get member name: ${error.message}`);
          }
          
          // Queue speaker event for Node.js processing
          const speakerEvent = {
            meeting_id: window.meetingId || 'unknown',
            member_id: speakerId,
            member_name: memberName,
            speaker_started_at: startTime.toISOString()
          };
          
          window.speakerEvents.push(speakerEvent);
          console.log(`✅ Speaker event queued`);
          
        } catch (error) {
          console.error(`❌ Failed to process speaker event: ${error.message}`);
        }
      };
      
      // Store meeting UUID for speaker events
      window.meetingId = 'unknown';
    });
    
    // Update meeting UUID in browser context
    await this.page.evaluate((meetingUuid) => {
      window.meetingId = meetingUuid;
    }, this.meetingUuid);
    
    // Start polling for speaker events from browser
    this.speakerEventInterval = setInterval(async () => {
      if (!this.isInMeeting) {
        clearInterval(this.speakerEventInterval);
        return;
      }

      try {
        // Get queued speaker events from browser
        const events = await this.page.evaluate(() => {
          const events = window.speakerEvents || [];
          window.speakerEvents = [];
          return events;
        });

        // Process each speaker event
        for (const event of events) {
          try {
            await this.backendClient.sendSpeakerEvent(event);
            this.logger(`✅ Speaker event sent: ${event.member_name || event.member_id}`, 'success');
          } catch (error) {
            this.logger(`❌ Failed to send speaker event: ${error.message}`, 'error');
          }
        }
      } catch (error) {
        this.logger(`❌ Speaker event processing error: ${error.message}`, 'error');
      }
    }, 1000); // Check every second

    this.logger('✅ Speaker event processing started', 'success');
  }

  // ============================================================================
  // AUDIO PROCESSING (Same as original)
  // ============================================================================

  async initializeAudioProcessor() {
    this.logger('🔧 Initializing AudioProcessor with meeting UUID...', 'info');
    
    this.audioProcessor = new AudioProcessor(this.meetingUuid, this.hostEmail, this.backendClient);
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
    
    this.logger(`🔄 Processing MediaRecorder chunk #${chunkId}`, 'info');
    
    try {
      const webmBuffer = Buffer.from(audioChunk.data);
      const wavBuffer = await this.convertWebmToWav(webmBuffer);
      
      // Calculate timing data for the chunk
      const chunkEndTime = new Date();
      const chunkStartTime = new Date(chunkEndTime.getTime() - 10000); // 10 seconds back
      
      await this.backendClient.sendAudioChunk(
        this.meetingUuid, 
        chunkId, 
        wavBuffer, 
        this.hostEmail,
        chunkStartTime.toISOString(), // audio_started_at
        chunkEndTime.toISOString()    // audio_ended_at
      );
      this.logger(`✅ WAV chunk sent successfully with timing data`, 'success');
    } catch (error) {
      this.logger(`❌ Failed to process MediaRecorder chunk: ${error.message}`, 'error');
    }
  }

  async convertWebmToWav(webmBuffer) {
    const tempDir = os.tmpdir();
    const inputFile = path.join(tempDir, `webm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webm`);
    const outputFile = path.join(tempDir, `wav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`);
    
    try {
      await fs.writeFile(inputFile, webmBuffer);
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputFile)
          .audioCodec('pcm_s16le')
          .audioChannels(1)
          .audioFrequency(16000)
          .format('wav')
          .output(outputFile)
          .on('error', reject)
          .on('end', resolve)
          .run();
      });
      
      const wavBuffer = await fs.readFile(outputFile);
      
      await fs.unlink(inputFile).catch(() => {});
      await fs.unlink(outputFile).catch(() => {});
      
      return wavBuffer;
      
    } catch (error) {
      await fs.unlink(inputFile).catch(() => {});
      await fs.unlink(outputFile).catch(() => {});
      throw error;
    }
  }

  // ============================================================================
  // CLEANUP AND LIFECYCLE
  // ============================================================================

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
        this.logger('⚠️ Browser monitoring stopped (page closed)', 'info');
        clearInterval(this.closeMonitorInterval);
      }
    }, 1000);
  }

  async cleanup() {
    this.logger('🧹 Starting comprehensive multistream cleanup...', 'info');
    
    // 1. Set meeting state to false
    this.isInMeeting = false;
    
    // 2. Clear all Node.js intervals
    if (this.closeMonitorInterval) {
      clearInterval(this.closeMonitorInterval);
      this.closeMonitorInterval = null;
    }
    
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
    }
    
    if (this.speakerEventInterval) {
      clearInterval(this.speakerEventInterval);
      this.speakerEventInterval = null;
    }
    
    // 2.5 Update meeting status in backend
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
    
    // 3. Clean up browser-side resources
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.evaluate(() => {
          // Leave Webex meeting gracefully
          if (window.currentMeeting) {
            try {
              console.log('🚪 Leaving Webex meeting...');
              window.currentMeeting.leave();
            } catch (error) {
              console.warn('⚠️ Error leaving meeting:', error.message);
            }
          }
          
          // Stop and clean up MediaRecorder
          if (window.stopMediaRecorder) {
            window.stopMediaRecorder();
            window.stopMediaRecorder = null;
          }
          if (window.mediaRecorder) {
            window.mediaRecorder = null;
          }
          
          // Clean up audio elements
          const remoteAudioElement = document.getElementById('multistream-remote-audio');
          if (remoteAudioElement) {
            remoteAudioElement.srcObject = null;
            remoteAudioElement.remove();
          }
          
          // Clear global variables
          window.webexAudioStream = null;
          window.audioChunkReady = null;
          window.speakerEvents = [];
          window.currentMeeting = null;
          
          // Clear speaker debouncing timers
          if (window.speakerDebounceTimer) {
            clearTimeout(window.speakerDebounceTimer);
            window.speakerDebounceTimer = null;
          }
          if (window.silenceTimer) {
            clearTimeout(window.silenceTimer);
            window.silenceTimer = null;
          }
          
          console.log('✅ Browser-side cleanup completed');
        });
      }
    } catch (error) {
      this.logger(`⚠️ Browser cleanup error: ${error.message}`, 'warn');
    }
    
    // 4. Close browser page
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.logger('✅ Browser page closed', 'success');
      }
    } catch (error) {
      this.logger(`⚠️ Error closing page: ${error.message}`, 'warn');
    }
    
    // 5. Reset instance variables
    this.meetingUrl = null;
    this.meetingUuid = null;
    this.webexMeetingId = null;
    this.hostEmail = null;
    this.audioProcessor = null;
    
    this.logger('✅ Comprehensive multistream cleanup completed', 'success');
  }

  async leaveMeeting() {
    this.logger('👋 Leaving multistream meeting...', 'info');
    this.isInMeeting = false;
    
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
    }
    
    if (this.speakerEventInterval) {
      clearInterval(this.speakerEventInterval);
      this.speakerEventInterval = null;
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
        const remoteAudioElement = document.getElementById('multistream-remote-audio');
        if (remoteAudioElement) {
          remoteAudioElement.srcObject = null;
          remoteAudioElement.remove();
        }
        
        // Clear global variables
        window.webexAudioStream = null;
        window.audioChunkReady = null;
        window.speakerEvents = [];
        
        // Clear speaker debouncing timers
        if (window.speakerDebounceTimer) {
          clearTimeout(window.speakerDebounceTimer);
        }
        if (window.silenceTimer) {
          clearTimeout(window.silenceTimer);
        }
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

    this.logger('✅ Multistream meeting left successfully', 'success');
  }

  getStatus() {
    return {
      isInMeeting: this.isInMeeting,
      meetingUrl: this.meetingUrl,
      meetingUuid: this.meetingUuid,
      webexMeetingId: this.webexMeetingId,
      hostEmail: this.hostEmail,
      mode: 'headless-multistream',
      audioProcessing: !!this.audioProcessor,
      speakerEventProcessing: !!this.speakerEventInterval,
      features: ['multistream', 'speaker-detection', 'debouncing']
    };
  }
}

module.exports = { MultistreamWebexClient };
