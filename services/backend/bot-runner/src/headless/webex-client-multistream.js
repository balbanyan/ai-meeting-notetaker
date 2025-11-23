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

  async joinMeeting(meetingUrl, meetingUuid, hostEmail = null) {
    try {
      this.logger('🚀 Starting headless multistream meeting join...', 'info');
      this.meetingUrl = meetingUrl;
      this.meetingUuid = meetingUuid;  // Passed from embedded app via backend
      this.hostEmail = hostEmail;  // Passed from embedded app
      
      // Test backend connection
      await this.testBackendConnection();

      // Registration already done by embedded app - skip backend call

      // Set up browser environment
      await this.setupBrowserEnvironment();
      
      // Initialize Webex with multistream and join meeting
      await this.initializeMultistreamWebexAndJoin(meetingUrl);
      
      // Set up audio processing
      await this.initializeAudioProcessor();
      await this.setupAudioProcessing();
      
      // Set up speaker event processing
      await this.setupSpeakerEventProcessing();

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
            debounceThreshold: 2000,      // 2 seconds
            silenceThreshold: 500,        // 0.5 seconds  
            enableDebouncing: true
          };
          
          // Screenshot/screenshare state tracking
          window.isScreensharing = false;
          window.screenShareVideoElement = null;
          
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
    
    // Expose Node.js cleanup function to browser for direct event-driven cleanup
    await this.page.exposeFunction('triggerNodeCleanup', async (reason, timestamp) => {
      this.logger(`========================================`, 'warn');
      this.logger(`🔴 CLEANUP CALLED FROM BROWSER`, 'warn');
      this.logger(`Reason: ${reason}`, 'warn');
      this.logger(`Timestamp: ${timestamp}`, 'warn');
      this.logger(`========================================`, 'warn');
      await this.cleanup();
    });
    this.logger('✅ Node.js cleanup function exposed to browser', 'success');
    
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
    
    // Forward console logs from browser (selective filtering)
      this.page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        
        // Keep only: timing logs, connection info, DEBUG logs, and key milestones
        const isTimingLog = /\(\d+(ms|s)\)/.test(text);
        const isConnectionLog = text.startsWith('🌐 Connection:');
        const isDebugLog = text.includes('[DEBUG]');
        const isMilestone = text.includes('✅') || text.includes('❌');
        const isCriticalStep = text.includes('Starting Webex SDK') || 
                               text.includes('Joining meeting') || 
                               text.includes('Starting addMedia');
        
        if (isTimingLog || isConnectionLog || isDebugLog || isMilestone || isCriticalStep) {
          if (type === 'error') {
            this.logger(`[Browser Console ERROR] ${text}`, 'error');
          } else if (type === 'warning') {
            this.logger(`[Browser Console WARN] ${text}`, 'warn');
          } else {
            this.logger(`[Browser Console] ${text}`, 'info');
          }
        }
      });
    
    const result = await this.page.evaluate(async (meetingUrl, config) => {
      try {
        // Timing tracker
        const timings = {
          sdkInitStart: Date.now()
        };
        
        console.log('🔧 Starting Webex SDK initialization...');
        
        // Wait for Webex to be available
        while (typeof window.Webex === 'undefined') {
          console.log('⏳ Waiting for Webex SDK...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Initialize Webex SDK with bot access token
        let webex;
        try {
          webex = window.Webex.init({
          credentials: {
            access_token: config.webex.botAccessToken
          },
          config: {
            logger: { level: 'info' },
            meetings: { enableRtx: true }
          }
        });
          timings.sdkInitEnd = Date.now();
          console.log(`✅ SDK initialized (${timings.sdkInitEnd - timings.sdkInitStart}ms)`);
        } catch (err) {
          timings.sdkInitEnd = Date.now();
          console.error(`❌ SDK initialization failed after ${timings.sdkInitEnd - timings.sdkInitStart}ms: ${err.message}`);
          throw err;
        }
        
        // Validate bot authentication and register
        console.log('🔐 Validating bot authentication...');
        timings.registerStart = Date.now();
        try {
            const botInfo = await webex.people.get('me');
            console.log(`✅ Bot authenticated: ${botInfo.displayName}`);
            
            // Register with Webex Cloud
            console.log('📱 Registering with Webex Cloud...');
            await webex.meetings.register();
            timings.registerEnd = Date.now();
            console.log(`✅ Registration complete (${timings.registerEnd - timings.registerStart}ms)`);
        } catch (err) {
            timings.registerEnd = Date.now();
            console.error(`❌ Registration failed after ${timings.registerEnd - timings.registerStart}ms: ${err.message}`);
            throw err;
        }

        // Create meeting
        console.log('📋 Creating meeting object...');
        timings.meetingCreateStart = Date.now();
        let meeting;
        try {
          meeting = await webex.meetings.create(meetingUrl);
          timings.meetingCreateEnd = Date.now();
          console.log(`✅ Meeting created (${timings.meetingCreateEnd - timings.meetingCreateStart}ms)`);
        } catch (err) {
          timings.meetingCreateEnd = Date.now();
          console.error(`❌ Meeting creation failed after ${timings.meetingCreateEnd - timings.meetingCreateStart}ms: ${err.message}`);
          throw err;
        }

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
          console.log(`📺 Screen sharing started - enabling screenshot capture`);
          window.isScreensharing = true;
        });
        
        meeting.on('meeting:stoppedSharingRemote', (data) => {
          console.log(`📺 Screen sharing stopped - disabling screenshot capture`);
          window.isScreensharing = false;
          if (window.screenShareVideoElement) {
            window.screenShareVideoElement.srcObject = null;
          }
        });
        
        // MULTISTREAM EVENT: Remote video layout changed (for screenshare stream)
        meeting.on('media:remoteVideo:layoutChanged', ({ layoutId, activeSpeakerVideoPanes, memberVideoPanes, screenShareVideo }) => {
          console.log(`🎬 Video layout changed: ${layoutId}`);
          
          if (screenShareVideo && screenShareVideo.stream) {
            console.log('🖼️ Screenshare stream available');
            
            // Create or update video element for screenshare
            if (!window.screenShareVideoElement) {
              const videoEl = document.createElement('video');
              videoEl.id = 'screenshare-video';
              videoEl.autoplay = true;
              videoEl.muted = true;
              videoEl.style.display = 'none';
              document.body.appendChild(videoEl);
              window.screenShareVideoElement = videoEl;
              console.log('✅ Created hidden screenshare video element');
            }
            
            window.screenShareVideoElement.srcObject = screenShareVideo.stream;
            console.log('✅ Screenshare stream attached to video element');
          }
        });

        // Handle media streams stopping - PRIMARY CLEANUP TRIGGER
        meeting.on('media:stopped', (media) => {
          console.log(`🔇 Meeting media stopped: ${media.type}`);
          
          if (media.type === 'remoteAudio') {
            const timestamp = new Date().toISOString();
            console.log('========================================');
            console.log('🔴 CLEANUP TRIGGER: remoteAudio stopped');
            console.log('Timestamp:', timestamp);
            console.log('This indicates meeting has ended or bot was removed');
            console.log('Calling Node.js cleanup function directly...');
            console.log('========================================');
            
            // Clean up audio resources
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
            
            // Directly trigger Node.js cleanup (instant, no polling!)
            if (window.triggerNodeCleanup) {
              window.triggerNodeCleanup('remoteAudio-stopped', timestamp)
                .catch(err => console.error('❌ Failed to trigger Node.js cleanup:', err));
            } else {
              console.error('❌ CRITICAL: triggerNodeCleanup function not available!');
            }
          }
        });


        // Join meeting with multistream enabled
        console.log('🚪 Joining meeting...');
        timings.joinStart = Date.now();
        try {
        await meeting.join({
          enableMultistream: true  // Enable multistream
        });
          timings.joinEnd = Date.now();
          console.log(`✅ Joined meeting (${timings.joinEnd - timings.joinStart}ms)`);
        } catch (err) {
          timings.joinEnd = Date.now();
          console.error(`❌ Join failed after ${timings.joinEnd - timings.joinStart}ms: ${err.message}`);
          throw err;
        }

        // Add media with multistream configuration
        console.log('🎧 Starting addMedia()...');
        timings.addMediaStart = Date.now();
        try {
        await meeting.addMedia({
          mediaOptions: {
              sendAudio: false,      // Don't send audio (receive-only bot)
              sendVideo: false,      // Don't send video (receive-only bot)
              receiveAudio: true,    // Receive audio
              receiveVideo: true     // Enable video for screenshare capture
          },
          remoteMediaManagerConfig: {
            audio: {
              numOfActiveSpeakerStreams: 1,  // Single audio stream
              numOfScreenShareStreams: 1
            },
            video: {
              preferLiveVideo: false,
              initialLayoutId: 'ScreenShareOnly',
              layouts: {
                ScreenShareOnly: {
                  screenShareVideo: { size: 'best' },  // Only receive screenshare
                  activeSpeakerVideoPaneGroups: []     // No participant videos
                }
              }
            }
          }
        });
          timings.addMediaEnd = Date.now();
          const durationSeconds = Math.round((timings.addMediaEnd - timings.addMediaStart)/1000);
          console.log(`✅ Media connected (${durationSeconds}s)`);
        } catch (addMediaError) {
          timings.addMediaEnd = Date.now();
          const durationSeconds = Math.round((timings.addMediaEnd - timings.addMediaStart)/1000);
          console.error(`❌ Media connection failed after ${durationSeconds}s: ${addMediaError.message}`);
          throw new Error(`Failed to add media after ${durationSeconds}s: ${addMediaError.message}`);
        }

        // Connection IP logging
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          const mediaProps = meeting.mediaProperties;
          if (mediaProps && mediaProps.webrtcMediaConnection) {
            const pc = mediaProps.webrtcMediaConnection.multistreamConnection?.pc;
            
            if (pc) {
              const stats = await pc.getStats();
              const candidates = new Map();
              let activePair = null;
              
              // Collect candidates
              stats.forEach((report) => {
                if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                  candidates.set(report.id, report);
                } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                  activePair = report;
                }
              });
              
              // Log connection details
              if (activePair && activePair.remoteCandidateId && activePair.localCandidateId) {
                const remoteCandidate = candidates.get(activePair.remoteCandidateId);
                const localCandidate = candidates.get(activePair.localCandidateId);
                
                // Also get transport stats to detect TURN-TLS
                let transportType = null;
                stats.forEach((report) => {
                  if (report.type === 'transport' && report.dtlsState === 'connected') {
                    // Check if using TLS (TURN-TLS)
                    if (report.selectedCandidatePairId === activePair.id) {
                      transportType = report.tlsVersion ? 'TLS' : null;
                    }
                  }
                });
                
                if (remoteCandidate) {
                  let ip = remoteCandidate.address || remoteCandidate.ip;
                  const protocol = remoteCandidate.protocol?.toUpperCase();
                  const remoteType = remoteCandidate.candidateType;
                  const localType = localCandidate?.candidateType;
                  
                  // Debug: Log candidate details
                  console.log(`[DEBUG] Remote candidate: type=${remoteType}, protocol=${protocol}, ip=${ip}`);
                  console.log(`[DEBUG] Local candidate: type=${localType}`);
                  console.log(`[DEBUG] Transport type: ${transportType || 'none'}`);
                  console.log(`[DEBUG] Active pair bytesReceived: ${activePair.bytesReceived}`);
                  
                  // Determine connection type label
                  // Note: TLS/DTLS is used for ALL WebRTC connections (including direct), so we can't use it to detect TURN
                  // Only relay candidate type or TCP protocol indicates TURN relay
                  let connectionType = '';
                  if (remoteType === 'relay' || localType === 'relay') {
                    // TURN relay - show as TURN-TLS since modern TURN uses TLS
                    connectionType = `${protocol} (TURN-TLS)`;
                  } else if (protocol === 'TCP') {
                    // TCP without relay type still indicates TURN (TCP punch-through rarely works)
                    connectionType = `TCP (TURN)`;
                  } else if (remoteType === 'srflx' || localType === 'srflx') {
                    // STUN reflexive - got public IP via STUN
                    connectionType = `${protocol} (STUN)`;
                  } else {
                    // Direct connection (host or prflx)
                    connectionType = `${protocol} (Direct)`;
                  }
                  
                  // Convert NAT64 IPv6 to IPv4 format
                  if (ip && ip.startsWith('64:ff9b::')) {
                    const ipv6 = ip;
                    // Extract hex part after 64:ff9b:: (e.g., "3e6d:ff4b")
                    const hexPart = ip.replace('64:ff9b::', '');
                    const parts = hexPart.split(':');
                    if (parts.length === 2) {
                      const octet1 = parseInt(parts[0].substring(0, 2), 16);
                      const octet2 = parseInt(parts[0].substring(2, 4), 16);
                      const octet3 = parseInt(parts[1].substring(0, 2), 16);
                      const octet4 = parseInt(parts[1].substring(2, 4), 16);
                      const ipv4 = `${octet1}.${octet2}.${octet3}.${octet4}`;
                      console.log(`🌐 Connection: ${connectionType} → ${ipv4} (NAT64: ${ipv6})`);
                    } else {
                      console.log(`🌐 Connection: ${connectionType} → ${ip}`);
                    }
                  } else {
                    console.log(`🌐 Connection: ${connectionType} → ${ip}`);
                  }
                }
              }
            }
          }
        } catch (err) {
          // Connection details not critical
        }

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
    
    // Calculate timing data for the chunk
    const chunkEndTime = new Date();
    const chunkStartTime = new Date(chunkEndTime.getTime() - 10000); // 10 seconds back
    
    // Capture screenshot at start of chunk if enabled
    let screenshotBuffer = null;
    if (config.screenshots.enabled) {
      screenshotBuffer = await this.captureScreenshot();
      if (screenshotBuffer) {
        this.logger(`📸 Screenshot captured for chunk #${chunkId}`, 'success');
      }
    }
    
    try {
      const webmBuffer = Buffer.from(audioChunk.data);
      const wavBuffer = await this.convertWebmToWav(webmBuffer);
      
      await this.backendClient.sendAudioChunk(
        this.meetingUuid, 
        chunkId, 
        wavBuffer, 
        this.hostEmail,
        chunkStartTime.toISOString(), // audio_started_at
        chunkEndTime.toISOString()    // audio_ended_at
      );
      this.logger(`✅ WAV chunk sent successfully with timing data`, 'success');
      
      // Send screenshot if captured
      if (screenshotBuffer) {
        try {
          await this.backendClient.sendScreenshot(
            this.meetingUuid,
            chunkId,
            chunkId, // audio_chunk_id will be resolved by backend
            screenshotBuffer,
            chunkStartTime.toISOString()
          );
          this.logger(`✅ Screenshot sent successfully for chunk #${chunkId}`, 'success');
        } catch (error) {
          this.logger(`⚠️ Failed to send screenshot: ${error.message}`, 'warn');
        }
      }
    } catch (error) {
      this.logger(`❌ Failed to process MediaRecorder chunk: ${error.message}`, 'error');
    }
  }

  async captureScreenshot() {
    if (!config.screenshots.enabled) return null;
    
    try {
      const screenshotData = await this.page.evaluate(() => {
        return new Promise((resolve) => {
          if (!window.isScreensharing || !window.screenShareVideoElement) {
            resolve(null);
            return;
          }
          
          // Create canvas and capture video frame
          const video = window.screenShareVideoElement;
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 1920;
          canvas.height = video.videoHeight || 1080;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0);
          
          // Convert to PNG blob
          canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve(Array.from(new Uint8Array(reader.result)));
            };
            reader.readAsArrayBuffer(blob);
          }, 'image/png');
        });
      });
      
      return screenshotData ? Buffer.from(screenshotData) : null;
    } catch (error) {
      this.logger(`❌ Failed to capture screenshot: ${error.message}`, 'error');
      return null;
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

  async cleanup() {
    this.logger('🧹 Starting comprehensive multistream cleanup...', 'info');
    
    // 1. Set meeting state to false
    this.isInMeeting = false;
    
    // 2. Clear all Node.js intervals
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
