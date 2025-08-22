/**
 * Electron Renderer for AI Meeting Notetaker V2
 * Uses shared API, processor, config, and JWT components
 * Implements Webex logic directly for optimal performance
 */

// Import shared components
const { config } = window.require('../shared/config');
const { BackendClient } = window.require('../shared/api/http-client');
const { AudioProcessor } = window.require('../shared/audio/processor');
const { WebexAPI } = window.require('../shared/api/webex-api');
const { JWTGenerator } = window.require('../shared/webex/jwt');
const { generateUUID, createElectronLogger, showStatus, testBackend } = window.require('../shared/utils');

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let webex = null;
let currentMeeting = null;
let meetingId = null;
let hostEmail = null;
let audioProcessor = null;
let meetingAudioContext = null;
let isInMeeting = false;

// Create Electron logger and make it available globally for shared modules
const logsContainer = document.getElementById('logs');
const addLog = createElectronLogger(logsContainer);
window.addLog = addLog;

// Initialize components (after logger is available)
const backendClient = new BackendClient();
const webexAPI = new WebexAPI();
const jwtGenerator = new JWTGenerator(config);

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
    addLog('🚀 Bot Runner V2 starting...', 'info');
    showStatus('Bot Runner V2 ready - Enter meeting details above', 'info');
    
    // Initialize Webex SDK
    initializeWebexSDK();
});

// ============================================================================
// WEBEX SDK INITIALIZATION (Direct Implementation)
// ============================================================================

async function initializeWebexSDK() {
    try {
        addLog('🔧 Initializing Webex SDK...', 'info');
        
        // Initialize Webex SDK directly
        webex = window.Webex.init({
            config: {
                logger: {
                    level: 'info'
                },
                meetings: {
                    enableRtx: true
                }
            }
        });
        
        addLog('✅ Webex SDK instance created with enhanced logging', 'success');
        
        // Generate JWT using shared component
        const jwtToken = jwtGenerator.buildJWT();
        
        // Authenticate using JWT
        addLog('🔐 Authenticating with JWT...', 'info');
        await webex.authorization.requestAccessTokenFromJwt({
            jwt: jwtToken
        });
        addLog('🔐 SDK authorization successful', 'success');
        
        // Register device
        addLog('📱 Registering device...', 'info');
        await webex.meetings.register();
        addLog('📱 Device registered successfully', 'success');
        
        addLog('✅ Webex SDK initialized successfully', 'success');
        
        // Make debugging available
        window.debugWebex = () => {
            console.log('Webex instance:', webex);
            console.log('Current meeting:', currentMeeting);
            console.log('Meeting ID:', meetingId);
            console.log('Host email:', hostEmail);
            console.log('Audio processor:', audioProcessor);
        };
        
        addLog('🔧 Console debugging: Open DevTools → Console → Try debugWebex()', 'info');
        
    } catch (error) {
        addLog(`❌ Failed to initialize Webex SDK: ${error.message}`, 'error');
        showStatus(`Webex initialization failed: ${error.message}`, 'error');
        throw error;
    }
}

// ============================================================================
// MEETING MANAGEMENT (Direct Implementation)
// ============================================================================

async function joinMeeting() {
    try {
    const meetingUrl = document.getElementById('meetingUrl').value.trim();
    if (!meetingUrl) {
        addLog('❌ Please enter a meeting URL', 'error');
            showStatus('Please enter a meeting URL', 'error');
        return;
    }
    
        addLog('🚀 Joining meeting...', 'info');
        showStatus('Joining meeting...', 'info');
        
        // Generate meeting ID
        meetingId = generateUUID();
        addLog('📋 Meeting session started', 'info');

        // Create meeting object directly
        currentMeeting = await webex.meetings.create(meetingUrl);
        addLog('✅ Meeting object created', 'success');
        
        // Set up event listeners directly
        setupMeetingEventListeners();
        
        // Join meeting with media directly
        await joinMeetingWithMedia();
        
        // Update UI
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;
        showStatus('Successfully joined meeting', 'success');
        isInMeeting = true;
        
    } catch (error) {
        addLog(`❌ Failed to join meeting: ${error.message}`, 'error');
        showStatus(`Failed to join meeting: ${error.message}`, 'error');
        console.error('Join meeting error:', error);
    }
}

function setupMeetingEventListeners() {
    addLog('🎧 Setting up meeting event listeners (direct implementation)...', 'info');
    
    // Error handling
    currentMeeting.on('error', (error) => {
        addLog(`❌ Meeting error: ${error.message}`, 'error');
        showStatus(`Meeting error: ${error.message}`, 'error');
    });
    
    // Media ready event - handle remote audio directly
    currentMeeting.on('media:ready', async (media) => {
        addLog(`🎵 Meeting media ready: ${media.type}`, 'success');
        addLog(`🔍 Media details: type=${media.type}, hasStream=${!!media.stream}`, 'info');
        
        if (media.stream) {
            addLog(`🔍 Stream tracks: ${media.stream.getTracks().length} (${media.stream.getTracks().map(t => t.kind).join(', ')})`, 'info');
        }
        
        if (media.type === 'remoteAudio' && media.stream) {
            await handleRemoteAudio(media.stream);
        } else if (media.type === 'remoteVideo') {
            addLog('📹 Remote video stream available (not processed)', 'info');
        }
    });
    
    // Media stopped event
    currentMeeting.on('media:stopped', (media) => {
        addLog(`🔇 Meeting media stopped: ${media.type}`, 'info');
        
        if (media.type === 'remoteAudio') {
            handleMediaCleanup();
        } else if (media.type === 'remoteVideo') {
            addLog('📹 Remote video stream stopped', 'info');
        }
    });
    
    // Meeting joined event
    currentMeeting.on('self:unlocked', async () => {
        addLog('🎉 Meeting joined successfully', 'success');
        
        // Get host email using shared WebexAPI
        try {
            hostEmail = await webexAPI.getHostEmail(currentMeeting);
            if (hostEmail) {
                addLog(`👤 Host email retrieved: ${hostEmail}`, 'success');
            }
        } catch (error) {
            addLog(`⚠️ Could not retrieve host email: ${error.message}`, 'warn');
            hostEmail = 'unknown@example.com';
        }
    });
    
    // Meeting lifecycle events
    currentMeeting.on('meeting:left', () => handleMeetingEnd('meeting:left'));
    currentMeeting.on('meeting:ended', () => handleMeetingEnd('meeting:ended'));
    currentMeeting.on('meeting:inactive', () => handleMeetingEnd('meeting:inactive'));
    
    // Audio mute events for debugging
    currentMeeting.on('media:remoteAudioMuted', () => {
        addLog('🔇 Remote audio muted', 'info');
    });
    
    currentMeeting.on('media:remoteAudioUnmuted', () => {
        addLog('🔊 Remote audio unmuted', 'info');
    });
}

async function joinMeetingWithMedia() {
    addLog('🎯 Joining meeting first (simple join)...', 'info');
    await currentMeeting.join();
    addLog('✅ Successfully joined meeting', 'success');

    addLog('🎧 Adding media to meeting with receiveAudio: true...', 'info');
    await currentMeeting.addMedia({
        mediaOptions: {
            receiveAudio: true
        }
    });
    addLog('✅ Media added successfully with receiveAudio: true', 'success');
}

// ============================================================================
// AUDIO HANDLING (Direct Implementation with Official SDK Approach)
// ============================================================================

async function handleRemoteAudio(stream) {
    addLog('🎧 Remote audio stream detected, using official SDK approach...', 'success');
    
    // Create or recreate audio element dynamically to avoid reuse issues
    let remoteAudioElement = document.getElementById('remote-view-audio');
    if (remoteAudioElement) {
        if (remoteAudioElement._wasConnectedToSource) {
            addLog('🔄 Recreating audio element to avoid reuse...', 'info');
            remoteAudioElement.remove();
            remoteAudioElement = null;
        }
    }
    
    if (!remoteAudioElement) {
        remoteAudioElement = document.createElement('audio');
        remoteAudioElement.id = 'remote-view-audio';
        remoteAudioElement.autoplay = true;
        remoteAudioElement.style.display = 'none';
        document.body.appendChild(remoteAudioElement);
    }
    addLog('✅ Audio element ready', 'info');
    
    // Assign stream to audio element (official Webex SDK approach)
    remoteAudioElement.srcObject = stream;
    addLog('✅ Remote audio stream assigned to HTML audio element', 'success');
    
    // Set up audio processing when audio element loads
    remoteAudioElement.onloadedmetadata = async () => {
        addLog('🎵 Audio element loaded, starting capture from original stream...', 'success');
        
        try {
            // Use the original media stream for processing (key insight from docs)
            const meetingAudioStream = stream;
            await startMeetingAudioCapture(meetingAudioStream);
            addLog('✅ Audio capture started from original media stream', 'success');
            
        } catch (error) {
            addLog(`❌ Failed to capture from original stream: ${error.message}`, 'error');
        }
    };
}

async function startMeetingAudioCapture(meetingAudioStream) {
    addLog('🎧 Starting meeting audio capture from remote audio stream...', 'info');
    
    // Log stream details
    const tracks = meetingAudioStream.getTracks();
    addLog(`🎵 Meeting audio stream has ${tracks.length} audio track(s)`, 'info');
    
    tracks.forEach((track, index) => {
        addLog(`🔊 Audio track: ${track.id}, enabled: ${track.enabled}`, 'info');
        const settings = track.getSettings();
        addLog(`🔊 Track settings: ${JSON.stringify(settings)}`, 'info');
        addLog(`🔊 Track muted: ${track.muted}, readyState: ${track.readyState}`, 'info');
    });
    
    // Test stream for activity first
    addLog('🧪 Testing stream for audio activity...', 'info');
    const testResult = await testAudioStreamActivity(meetingAudioStream, 1000);
    addLog(`🧪 Stream test: hasActivity=${testResult.hasActivity}, maxSample=${testResult.maxSample.toFixed(4)}`, 'info');
    
    try {
        // Create audio processor instance using shared component (correct constructor)
        audioProcessor = new AudioProcessor(meetingId, hostEmail, backendClient);
        
        // Start processing using shared audio processor
        await audioProcessor.startProcessing(meetingAudioStream);
        
        addLog('✅ Meeting audio capture started successfully', 'success');
        
    } catch (error) {
        addLog(`❌ Failed to start audio capture: ${error.message}`, 'error');
        throw error;
    }
}

async function testAudioStreamActivity(stream, durationMs = 1000) {
    return new Promise((resolve) => {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        let maxSample = 0;
        let hasActivity = false;
        
        const checkActivity = () => {
            analyser.getFloatTimeDomainData(dataArray);
            
            for (let i = 0; i < bufferLength; i++) {
                const abs = Math.abs(dataArray[i]);
                if (abs > maxSample) maxSample = abs;
                if (abs > 0.01) hasActivity = true;
            }
        };
        
        const interval = setInterval(checkActivity, 50);
        
        setTimeout(() => {
            clearInterval(interval);
            audioContext.close();
            resolve({ hasActivity, maxSample });
        }, durationMs);
    });
}

function handleMediaCleanup() {
    addLog('🛑 Remote audio stopped, cleaning up...', 'info');
    
    // Clean up audio element
    const remoteAudioElement = document.getElementById('remote-view-audio');
    if (remoteAudioElement) {
        remoteAudioElement.srcObject = null;
        remoteAudioElement.remove();
        addLog('✅ Remote audio element cleared', 'success');
    }
    
    // Clean up audio context
    if (meetingAudioContext) {
        meetingAudioContext.close();
        meetingAudioContext = null;
        addLog('✅ Meeting audio context cleaned up', 'success');
    }
    
    // Stop audio processor
    if (audioProcessor) {
        audioProcessor.stop();
        audioProcessor = null;
        addLog('✅ Audio processor stopped', 'success');
    }
}

// ============================================================================
// MEETING LIFECYCLE
// ============================================================================

async function handleMeetingEnd(eventType) {
    addLog(`🔚 Meeting ended (${eventType})`, 'info');
    
    // Stop audio processing
        if (audioProcessor) {
        audioProcessor.stop();
            audioProcessor = null;
        addLog('✅ Audio processing stopped', 'success');
    }
    
    // Reset state
    isInMeeting = false;
    meetingId = null;
    hostEmail = null;
    currentMeeting = null;
    
    // Update UI
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('leaveBtn').disabled = true;
    showStatus('Meeting ended', 'info');
}

async function leaveMeeting() {
    try {
        addLog('👋 Leaving meeting...', 'info');
        showStatus('Leaving meeting...', 'info');
        
        // Stop audio processing first
        if (audioProcessor) {
            addLog('🛑 Stopping audio processing...', 'info');
            audioProcessor.stop();
            audioProcessor = null;
            addLog('✅ Audio processing stopped', 'success');
        }
        
        // Leave meeting
        if (currentMeeting) {
            await currentMeeting.leave();
            addLog('✅ Meeting left successfully', 'success');
        }
        
        // Clean up
        cleanupMeeting();
        
    } catch (error) {
        addLog(`❌ Error leaving meeting: ${error.message}`, 'error');
        // Force cleanup even if leave fails
        cleanupMeeting();
    }
}

function cleanupMeeting() {
    addLog('🧹 Cleaning up meeting resources...', 'info');
    
    // Reset state
    isInMeeting = false;
    meetingId = null;
    hostEmail = null;
    currentMeeting = null;
    
    // Clean up audio context
    if (meetingAudioContext) {
        meetingAudioContext.close();
        meetingAudioContext = null;
    }
    
    // Update UI
    document.getElementById('joinBtn').disabled = false;
    document.getElementById('leaveBtn').disabled = true;
    showStatus('Ready for next meeting', 'success');
    
    addLog('✅ Meeting cleanup completed', 'success');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Test backend connection (UI wrapper)
 */
async function testBackendUI() {
    const success = await testBackend(backendClient, addLog);
    
    if (success) {
        showStatus('Backend connection OK', 'success');
    } else {
        showStatus('Backend connection failed', 'error');
    }
}

// ============================================================================
// GLOBAL FUNCTIONS (for HTML buttons)
// ============================================================================

// Make functions available globally for HTML onclick handlers
window.joinMeeting = joinMeeting;
window.leaveMeeting = leaveMeeting;
window.testBackendUI = testBackendUI;
