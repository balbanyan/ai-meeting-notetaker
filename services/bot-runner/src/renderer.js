// AI Meeting Notetaker V2 - Renderer Process
const { config } = window.require('./config');
const { BackendClient } = window.require('./http-client');
const { AudioProcessor } = window.require('./audio-processor');
const { WebexAPI } = window.require('./webex-api');

// Global variables
let webex = null;
let currentMeeting = null;
let audioProcessor = null;
let currentMeetingId = null;
let isInitialized = false;
let meetingId = null;
let webexAPI = null;
let hostEmail = null;

// Initialize on page load
window.addEventListener('DOMContentLoaded', async () => {
    addLog('🚀 Bot Runner V2 starting...', 'info');
    await initializeWebexSDK();
});

/**
 * Build JWT token following official Webex documentation exactly
 */
function buildJWT() {
    try {
        const CryptoJS = window.require('crypto-js');
        
        const payload = {
            sub: config.bot.email,
            name: config.bot.displayName,
            iss: config.webex.guestIssuerId,
            // 1h expiry time (as string like in docs)
            exp: (Math.floor(new Date().getTime() / 1000) + 60 * 60).toString(),
        };

        addLog(`JWT payload: ${JSON.stringify(payload, null, 2)}`, 'info');

        // Following the exact pattern from Webex docs
        const encodedHeader = CryptoJS.enc.Base64url.stringify(
            CryptoJS.enc.Utf8.parse(JSON.stringify({
                typ: "JWT",
                alg: "HS256",
            }))
        );
        
        const encodedPayload = CryptoJS.enc.Base64url.stringify(
            CryptoJS.enc.Utf8.parse(JSON.stringify(payload))
        );
        
        const encodedData = `${encodedHeader}.${encodedPayload}`;
        
        const signature = CryptoJS.HmacSHA256(
            encodedData,
            CryptoJS.enc.Base64.parse(config.webex.guestIssuerSecret)
        ).toString(CryptoJS.enc.Base64url);

        const jwt = `${encodedData}.${signature}`;
        addLog(`✅ JWT generated successfully (${jwt.length} chars)`, 'success');
        return jwt;
        
    } catch (error) {
        addLog(`❌ JWT generation failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Initialize Webex SDK (using require like working version)
 */
async function initializeWebexSDK() {
    try {
        addLog('🔧 Initializing Webex SDK...', 'info');
        
        // Use Webex SDK loaded from CDN (like V1 app)
        if (!window.Webex) {
            throw new Error('Webex SDK not loaded. Make sure to include it in HTML.');
        }
        
        webex = window.Webex.init();
        
        addLog('✅ Webex SDK instance created', 'success');
        
        // Build JWT and authenticate
        const jwt = buildJWT();
        
        await webex.authorization.requestAccessTokenFromJwt({ jwt });
        addLog('🔐 SDK authorization successful', 'success');
        
        // Register device
        await webex.meetings.register();
        addLog('📱 Device registered successfully', 'success');
        
        isInitialized = true;
        addLog('✅ Webex SDK initialized successfully', 'success');
        
    } catch (error) {
        addLog(`❌ Failed to initialize Webex SDK: ${error.message}`, 'error');
        console.error('Webex initialization error:', error);
    }
}

/**
 * Join a Webex meeting
 */
async function joinMeeting() {
    if (!isInitialized) {
        addLog('❌ Webex SDK not initialized', 'error');
        return;
    }
    
    const meetingUrl = document.getElementById('meetingUrl').value.trim();
    const hostName = document.getElementById('hostName').value.trim() || null;
    
    if (!meetingUrl) {
        addLog('❌ Please enter a meeting URL', 'error');
        return;
    }
    
    try {
        // Use meeting URL as the meeting ID for database tracking
        meetingId = meetingUrl;
        currentMeetingId = meetingId;
        
        addLog(`🚀 Joining meeting...`, 'info');
        addLog(`📋 Meeting session started`, 'info');
        
        // Create and join meeting (simplified)
        currentMeeting = await webex.meetings.create(meetingUrl);
        addLog('✅ Meeting object created', 'success');
        
        // Set up event listeners BEFORE joining
        addLog('🎧 Setting up meeting event listeners...', 'info');
        
        currentMeeting.on('self:unlocked', async () => {
            addLog('🔓 Successfully joined meeting (self:unlocked)!', 'success');
            
            // Get host email after successfully joining
            try {
                if (!webexAPI) {
                    webexAPI = new WebexAPI();
                }
                
                const meetingIdForAPI = webexAPI.extractMeetingId(currentMeeting);
                const accessToken = webexAPI.getAccessToken(webex);
                
                if (meetingIdForAPI && accessToken) {
                    hostEmail = await webexAPI.getHostEmail(meetingIdForAPI, accessToken);
                    if (hostEmail) {
                        addLog(`📧 Host email retrieved: ${hostEmail}`, 'success');
                    } else {
                        addLog('⚠️ Could not retrieve host email', 'warn');
                    }
                } else {
                    addLog('⚠️ Missing meeting ID or access token for host email retrieval', 'warn');
                }
            } catch (error) {
                addLog(`❌ Error retrieving host email: ${error.message}`, 'error');
                console.error('Host email retrieval error:', error);
            }
        });
        
        // Handle meeting termination scenarios
        currentMeeting.on('meeting:left', async () => {
            addLog('👋 Left meeting - cleaning up...', 'info');
            await handleMeetingEnd('meeting:left');
        });
        
        currentMeeting.on('meeting:ended', async () => {
            addLog('🏁 Meeting ended by host - cleaning up...', 'info');
            await handleMeetingEnd('meeting:ended');
        });
        
        currentMeeting.on('meeting:inactive', async () => {
            addLog('💤 Meeting became inactive - cleaning up...', 'info');
            await handleMeetingEnd('meeting:inactive');
        });
        
        currentMeeting.on('error', (error) => {
            addLog(`❌ Meeting error: ${error.message}`, 'error');
            console.error('Meeting error details:', error);
        });
        
        // Set up media listeners immediately 
        setupMediaEventListeners(currentMeeting);
        
        // Join the meeting
        await currentMeeting.join();
        addLog('✅ Meeting join request sent', 'success');
        
        // Try to establish media access after a short delay
        addLog('⏳ Waiting 5 seconds before establishing media access...', 'info');
        setTimeout(async () => {
            addLog('🎯 Attempting to establish media access...', 'info');
            try {
                await establishMediaAccess(currentMeeting);
                addLog('✅ Media access establishment completed', 'success');
            } catch (error) {
                addLog(`❌ Media access failed: ${error.message}`, 'error');
                console.error('Media access error:', error);
            }
        }, 5000);
        
        // Update UI
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;
        showStatus('Joined meeting successfully!', 'success');
        
        // Media access will be triggered by self:unlocked event
        
    } catch (error) {
        addLog(`❌ Failed to join meeting: ${error.message}`, 'error');
        console.error('Join meeting error:', error);
        showStatus(`Failed to join meeting: ${error.message}`, 'error');
    }
}

/**
 * Establish media access (simplified)
 */
async function establishMediaAccess(hostName) {
    try {
        addLog('🔍 Requesting media access...', 'info');
        await currentMeeting.addMedia({ receiveAudio: true });
        addLog('✅ Media access established', 'success');
    } catch (error) {
        addLog(`⚠️ Media access failed: ${error.message}`, 'error');
    }
}



/**
 * Start audio capture and processing
 */
async function startAudioCapture(mediaStream, hostName) {
    try {
        addLog('🎵 Starting audio capture...', 'info');
        
        // Initialize audio processor
        audioProcessor = new AudioProcessor(meetingId, hostName);
        
        // Start processing the audio stream
        await audioProcessor.startProcessing(mediaStream);
        
        addLog('✅ Audio capture started - 10-second chunks will be sent to backend', 'success');
        showStatus('Audio capture active - Processing 10-second chunks', 'info');
        
    } catch (error) {
        addLog(`❌ Failed to start audio capture: ${error.message}`, 'error');
        console.error('Audio capture error:', error);
    }
}

/**
 * Leave the current meeting
 */
async function leaveMeeting() {
    try {
        addLog('👋 Leaving meeting...', 'info');
        
        // Stop audio processing FIRST
        addLog('🛑 Stopping audio processing...', 'info');
        await stopAudioProcessing();
        addLog('✅ Audio processing stopped', 'success');
        
        // Then leave the meeting
        if (currentMeeting) {
            await currentMeeting.leave();
            addLog('✅ Meeting left successfully', 'success');
        }
        
        // Clean up UI and variables
        cleanupMeeting();
        addLog('✅ Meeting cleanup completed', 'success');
        showStatus('Left meeting successfully', 'success');
        
    } catch (error) {
        addLog(`❌ Failed to leave meeting: ${error.message}`, 'error');
        console.error('Leave meeting error:', error);
        
        // Force cleanup even if leaving failed
        try {
            await stopAudioProcessing();
            cleanupMeeting();
            addLog('🧹 Forced cleanup completed', 'info');
        } catch (cleanupError) {
            addLog(`⚠️ Force cleanup also failed: ${cleanupError.message}`, 'warn');
        }
    }
}



/**
 * Handle meeting end scenarios (unified cleanup function)
 */
async function handleMeetingEnd(eventType) {
    try {
        addLog(`🔄 Handling meeting end event: ${eventType}`, 'info');
        
        // Stop audio processing FIRST - this is critical
        if (audioProcessor) {
            addLog('🛑 Stopping audio processing...', 'info');
            await stopAudioProcessing();
            addLog('✅ Audio processing stopped', 'success');
        } else {
            addLog('ℹ️ No audio processor to stop', 'info');
        }
        
        // Clean up meeting resources
        cleanupMeeting();
        addLog('✅ Meeting cleanup completed', 'success');
        
    } catch (error) {
        addLog(`⚠️ Error during meeting cleanup: ${error.message}`, 'warn');
        console.error('Meeting cleanup error:', error);
        
        // Force cleanup even if there were errors
        try {
            cleanupMeeting();
            addLog('🧹 Forced cleanup completed', 'info');
        } catch (forceError) {
            addLog(`❌ Force cleanup also failed: ${forceError.message}`, 'error');
        }
    }
}

/**
 * Cleanup meeting resources (UI and variables only)
 */
function cleanupMeeting() {
    addLog('🧹 Cleaning up meeting resources...', 'info');
    
    // Reset meeting variables
    currentMeeting = null;
    currentMeetingId = null;
    meetingId = null;
    hostEmail = null;
    
    // Note: audioProcessor is cleaned up by stopAudioProcessing()
    // Don't try to stop it here to avoid conflicts
    
    // Update UI
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    
    if (joinBtn) joinBtn.disabled = false;
    if (leaveBtn) leaveBtn.disabled = true;
    
    showStatus('Ready to join new meeting', 'info');
    addLog('✅ Meeting resources cleaned up', 'info');
}

/**
 * Test backend connection
 */
async function testBackend() {
    try {
        addLog('🔍 Testing backend connection...', 'info');
        
        const client = new BackendClient();
        const success = await client.testConnection();
        
        if (success) {
            addLog('✅ Backend connection successful', 'success');
            showStatus('Backend connection OK', 'success');
        } else {
            addLog('❌ Backend connection failed', 'error');
            showStatus('Backend connection failed', 'error');
        }
        
    } catch (error) {
        addLog(`❌ Backend test failed: ${error.message}`, 'error');
        showStatus(`Backend test failed: ${error.message}`, 'error');
    }
}

/**
 * Add log entry to the UI
 */
function addLog(message, type = 'info') {
    const logsContainer = document.getElementById('logs');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
    
    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Show status message
 */
function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
    
    // Hide after 5 seconds for non-error messages
    if (type !== 'error') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 5000);
    }
}

/**
 * Set up media event listeners for audio processing
 */
function setupMediaEventListeners(meeting) {
    addLog('🎧 Setting up media event listeners...', 'info');
    
    // Listen for ALL media-related events for debugging
    const allMediaEvents = [
        'media:ready', 'media:stopped', 'media:negotiated', 
        'media:connected', 'media:disconnected', 'media:add',
        'media:request', 'media:response'
    ];
    
    allMediaEvents.forEach(eventName => {
        meeting.on(eventName, (data) => {
            addLog(`📡 Media Event: ${eventName}`, 'info');
            if (data && typeof data === 'object') {
                addLog(`📡 Event data: ${JSON.stringify(data, null, 2)}`, 'info');
            }
        });
    });
    
    // Listen for media streams
    meeting.on("media:ready", async ({ type, stream }) => {
        addLog(`🔥 Media ready: ${type}`, 'info');
        
        if (stream && stream.getTracks) {
            addLog(`Stream: ID=${stream.id || 'N/A'}, Active=${stream.active}, Tracks=${stream.getTracks().length}`, 'info');
        }
        
        // Process remote audio stream
        if (type === 'remoteAudio' && stream) {
            addLog('🎵 Starting audio processing...', 'info');
            try {
                await startAudioProcessingForMeeting(currentMeetingId, stream);
                addLog('✅ Audio processing started successfully', 'info');
            } catch (error) {
                addLog(`❌ Audio processing failed: ${error.message}`, 'error');
                console.error('Audio processing error:', error);
            }
        } else if (type === 'remoteAudio' && !stream) {
            addLog('⚠️ Remote audio detected but no stream provided', 'warn');
        }
        
        // Log other media types
        if (type === 'remoteVideo') {
            addLog('📹 Video stream available (not processed)', 'info');
        }
        if (type === 'remoteShare') {
            addLog('🖥️ Screen share available (not processed)', 'info');
        }
        if (type === 'localAudio') {
            addLog('🎤 Local audio stream detected', 'info');
        }
        if (type === 'localVideo') {
            addLog('📷 Local video stream detected', 'info');
        }
    });
    
    addLog('✅ All media event listeners registered', 'info');
}

/**
 * Start audio processing for meeting
 */
async function startAudioProcessingForMeeting(meetingId, mediaStream) {
    try {
        addLog(`🎵 Starting audio processing for current meeting`, 'info');
        
        // Validate inputs
        if (!mediaStream || !mediaStream.active) {
            throw new Error('Invalid or inactive media stream');
        }
        
        if (!mediaStream.getAudioTracks || mediaStream.getAudioTracks().length === 0) {
            throw new Error('No audio tracks found in media stream');
        }
        
        addLog(`🔧 [AUDIO-INIT] Backend API URL: ${config.backend?.url || 'Not set'}`, 'info');
        addLog(`🔧 [AUDIO-INIT] Service Token: ${config.bot?.serviceToken ? 'Present' : 'Missing'}`, 'info');
        
        // Initialize audio processor with 10-second chunks and host email
        addLog('🔧 [AUDIO-PROC] Initializing audio processor...', 'info');
        audioProcessor = new AudioProcessor(meetingId, hostEmail);
        
        // Start processing the media stream
        addLog('▶️ [AUDIO-PROC] Starting audio stream processing...', 'info');
        await audioProcessor.startProcessing(mediaStream);
        
        addLog('🎉 [AUDIO-INIT] Audio processing pipeline fully operational!', 'info');
        
    } catch (error) {
        addLog(`❌ [AUDIO-INIT] Audio processing setup failed: ${error.message}`, 'error');
        
        // Clean up on error
        if (audioProcessor) {
            try {
                audioProcessor.stopProcessing();
                addLog('🧹 [AUDIO-CLEANUP] Audio processor stopped', 'info');
            } catch (cleanupError) {
                addLog(`⚠️ [AUDIO-CLEANUP] Audio processor cleanup failed: ${cleanupError.message}`, 'warn');
            }
            audioProcessor = null;
        }
        
        throw error;
    }
}

/**
 * Stop audio processing
 */
async function stopAudioProcessing() {
    try {
        addLog('🛑 Stopping audio processing...', 'info');
        
        if (audioProcessor) {
            addLog('🔧 Calling audioProcessor.stop()...', 'info');
            audioProcessor.stop();
            audioProcessor = null;
            addLog('✅ Audio processor stopped and cleared', 'success');
        } else {
            addLog('ℹ️ No audio processor to stop', 'info');
        }
        
        addLog('🎵 Audio processing stopped successfully', 'success');
        
    } catch (error) {
        addLog(`❌ Error stopping audio processing: ${error.message}`, 'error');
        
        // Force clear the processor even if stopping failed
        audioProcessor = null;
        addLog('🧹 Audio processor forcibly cleared', 'warn');
        
        throw error; // Re-throw so caller knows it failed
    }
}

/**
 * Establish media access
 */
async function establishMediaAccess(meeting) {
    addLog('🎯 Establishing media access...', 'info');
    
    try {
        // Request media access
        await meeting.addMedia({
            mediaSettings: {
                receiveVideo: false,   // We don't need video
                receiveAudio: true,    // WE NEED AUDIO!
                receiveShare: false,   // We don't need screen share
                sendVideo: false,      // Bot doesn't send video
                sendAudio: false,      // Bot doesn't send audio (for now)
                sendShare: false       // Bot doesn't send screen share
            },
            localStream: null,         // No local stream to send
            localShare: null           // No local share to send
        });
        
        addLog('✅ Media access established successfully', 'info');
        
    } catch (addMediaError) {
        addLog(`⚠️ addMedia() failed: ${addMediaError.message}`, 'warn');
        
        // Method 2: Try getMediaStreams() fallback
        try {
            const [stream] = await meeting.getMediaStreams({
                sendAudio: true,
                sendVideo: false,
                sendShare: false,
            }, {
                audio: null,
            });
            
            // Stop the stream immediately (we just needed to trigger media access)
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
                addLog('✅ Media access established via getMediaStreams()', 'info');
            }
            
        } catch (getStreamError) {
            throw new Error(`Media establishment failed: ${addMediaError.message}`);
        }
    }
    
    // Wait for media to establish
    await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * Generate simple UUID
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
