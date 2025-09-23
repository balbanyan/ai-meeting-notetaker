/**
 * Multistream Electron Renderer for AI Meeting Notetaker
 * Uses Webex multistream API with single audio stream and speaker change detection
 * Based on current renderer.js but with multistream events
 */

// Import shared components
const { config } = window.require('../shared/config');
const { BackendClient } = window.require('../shared/api/http-client');
const { AudioProcessor } = window.require('../shared/audio/processor');
const { WebexAPI } = window.require('../shared/api/webex-api');
const { createElectronLogger, showStatus, testBackend } = window.require('../shared/utils');

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

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
    addLog('🚀 Multistream Bot Runner starting...', 'info');
    showStatus('Multistream Bot Runner ready - Enter meeting details above', 'info');
    
    // Initialize Webex SDK
    initializeWebexSDK();
});

// ============================================================================
// WEBEX SDK INITIALIZATION (Multistream Implementation)
// ============================================================================

async function initializeWebexSDK() {
    try {
        addLog('🔧 Initializing Webex SDK with multistream support...', 'info');
        
        // Initialize Webex SDK with bot access token (official method)
        webex = window.Webex.init({
            credentials: {
                access_token: config.webex.botAccessToken
            },
            config: {
                logger: {
                    level: 'info'
                },
                meetings: {
                    enableRtx: true
                }
            }
        });

        addLog('✅ Webex SDK initialized with bot access token', 'success');
        
        // Validate bot authentication before registering for meetings
        addLog('🔐 Validating bot authentication...', 'info');
        try {
            const botInfo = await webex.people.get('me');
            addLog(`✅ Bot authenticated: ${botInfo.displayName}`, 'success');
            
            // Register with Webex Cloud
            addLog('📱 Registering with Webex Cloud...', 'info');
            webex.meetings.register()
              .then(() => {
                addLog('📱 Device registered successfully', 'success');
              })
              .catch((err) => {
                console.error('Registration error:', err);
                addLog(`❌ Device registration failed: ${err.message}`, 'error');
              });
        } catch (err) {
            addLog(`❌ Bot authentication failed: ${err.message}`, 'error');
            throw err;
        }
        
        addLog('✅ Webex SDK initialized successfully with multistream support', 'success');
        
        // Display speaker detection configuration
        addLog(`🎛️ Speaker Config: Debounce=${SPEAKER_CONFIG.debounceThreshold}ms, Silence=${SPEAKER_CONFIG.silenceThreshold}ms, Enabled=${SPEAKER_CONFIG.enableDebouncing}`, 'info');
        
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
// MEETING MANAGEMENT (Multistream Implementation)
// ============================================================================

async function joinMeeting() {
    try {
        const meetingUrl = document.getElementById('meetingUrl').value.trim();
        if (!meetingUrl) {
            addLog('❌ Please enter a meeting URL', 'error');
            showStatus('Please enter a meeting URL', 'error');
            return;
        }
        
        addLog('🚀 Joining meeting with multistream...', 'info');
        showStatus('Joining meeting with multistream...', 'info');
        
        // Use meeting URL as session ID
        meetingId = meetingUrl;
        addLog('📋 Meeting session started', 'info');
        
        // Create meeting object directly
        currentMeeting = await webex.meetings.create(meetingUrl);
        addLog('✅ Meeting object created', 'success');
        
        // Set up event listeners for multistream
        setupMultistreamEventListeners();
        
        // Join meeting with multistream media
        await joinMeetingWithMultistreamMedia();
        
        // Update UI
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;
        showStatus('Successfully joined meeting with multistream', 'success');
        isInMeeting = true;
        
    } catch (error) {
        addLog(`❌ Failed to join meeting: ${error.message}`, 'error');
        showStatus(`Failed to join meeting: ${error.message}`, 'error');
        console.error('Join meeting error:', error);
    }
}

function setupMultistreamEventListeners() {
    addLog('🎧 Setting up multistream event listeners...', 'info');
    
    // Error handling
    currentMeeting.on('error', (error) => {
        addLog(`❌ Meeting error: ${error.message}`, 'error');
        showStatus(`Meeting error: ${error.message}`, 'error');
    });
    
    // MULTISTREAM EVENT: Remote audio created (replaces media:ready)
    currentMeeting.on('media:remoteAudio:created', (audioMediaGroup) => {
        addLog('🎵 Multistream remote audio created', 'success');
        handleMultistreamRemoteAudio(audioMediaGroup);
    });
    
    // MULTISTREAM EVENT: Active speaker changed
    currentMeeting.on('media:activeSpeakerChanged', ({ memberIds }) => {
        addLog(`🗣️ Active speaker changed: ${memberIds ? memberIds.length : 0} speakers`, 'info');
        handleSpeakerChange(memberIds);
    });
    
    // ADDITIONAL USEFUL MULTISTREAM EVENTS
    
    // Audio source count changes (useful for debugging)
    currentMeeting.on('media:remoteAudioSourceCountChanged', ({ numTotalSource, numLiveSources }) => {
        addLog(`🔊 Audio sources changed: ${numLiveSources}/${numTotalSource} live`, 'info');
    });
    
    // Screen sharing events (could be useful for meeting context)
    currentMeeting.on('meeting:startedSharingRemote', (data) => {
        addLog(`📺 Screen sharing started by remote participant`, 'info');
    });
    
    currentMeeting.on('meeting:stoppedSharingRemote', (data) => {
        addLog(`📺 Screen sharing stopped by remote participant`, 'info');
    });
    
    // Handle media streams stopping
    currentMeeting.on('media:stopped', (media) => {
        addLog(`🔇 Meeting media stopped: ${media.type}`, 'info');
        
        if (media.type === 'remoteAudio') {
            handleMediaCleanup();
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
    
    // Meeting end events
    currentMeeting.on('meeting:ended', () => {
        addLog('🏁 Meeting ended by host', 'info');
        handleMeetingEnd('meeting:ended');
    });
    
    currentMeeting.on('meeting:inactive', () => {
        addLog('💤 Meeting became inactive', 'info');  
        handleMeetingEnd('meeting:inactive');
    });
}

async function joinMeetingWithMultistreamMedia() {
    addLog('🎯 Joining meeting first (simple join)...', 'info');
    await currentMeeting.join({
        enableMultistream: true  // Enable multistream
    });
    addLog('✅ Successfully joined meeting with multistream enabled', 'success');

    addLog('🎧 Adding media with multistream configuration (audio focus)...', 'info');
    await currentMeeting.addMedia({
        mediaOptions: {
            receiveAudio: true,
            receiveVideo: false  // We don't need video streams
        },
        remoteMediaManagerConfig: {
            audio: {
                numOfActiveSpeakerStreams: 1,  // Single audio stream as requested
                numOfScreenShareStreams: 1
            },
            video: {
                preferLiveVideo: false,  // We don't care about video quality
                initialLayoutId: 'Single',
                layouts: {
                    Single: {
                        activeSpeakerVideoPaneGroups: []  // Empty - no video panes needed
                    }
                }
            }
        }
    });
    addLog('✅ Media added successfully with audio-focused multistream config', 'success');
}

// ============================================================================
// MULTISTREAM AUDIO HANDLING
// ============================================================================

function createSingleAudioElement() {
    addLog('🎧 Creating single multistream audio element...', 'info');
    
    // Remove existing element if present
    const existingElement = document.getElementById('multistream-remote-audio');
    if (existingElement) {
        existingElement.remove();
    }
    
    // Create new audio element
    const audioElement = document.createElement('audio');
    audioElement.id = 'multistream-remote-audio';
    audioElement.autoplay = true;
    audioElement.style.display = 'none';
    document.body.appendChild(audioElement);
    
    addLog('✅ Single multistream audio element created', 'success');
    return audioElement;
}

async function handleMultistreamRemoteAudio(audioMediaGroup) {
    addLog('🎧 Handling multistream remote audio...', 'info');
    
    try {
        // Get remote media from the group
        const remoteMediaArray = audioMediaGroup.getRemoteMedia();
        addLog(`🔍 Received ${remoteMediaArray.length} audio streams`, 'info');
        
        if (remoteMediaArray.length > 0) {
            const firstMedia = remoteMediaArray[0]; // Use only first stream as requested
            
            addLog(`🎵 Processing first audio stream: ${firstMedia.id}`, 'info');
            addLog(`🔍 Stream state: ${firstMedia.sourceState}, Member: ${firstMedia.memberId || 'unknown'}`, 'info');
            
            if (firstMedia.stream) {
                // Create single audio element
                const audioElement = createSingleAudioElement();
                audioElement.srcObject = firstMedia.stream;
                
                addLog('✅ Audio stream attached to element', 'success');
                
                // Set up audio processing when element loads
                audioElement.onloadedmetadata = async () => {
                    addLog('🎵 Multistream audio element loaded, starting capture...', 'success');
                    
                    try {
                        await startMultistreamAudioCapture(firstMedia.stream);
                        addLog('✅ Multistream audio capture started successfully', 'success');
                    } catch (error) {
                        addLog(`❌ Failed to start multistream audio capture: ${error.message}`, 'error');
                    }
                };
            } else {
                addLog('⚠️ No audio stream available in first media', 'warn');
            }
        } else {
            addLog('⚠️ No remote media received in audio group', 'warn');
        }
    } catch (error) {
        addLog(`❌ Error handling multistream remote audio: ${error.message}`, 'error');
    }
}

async function startMultistreamAudioCapture(audioStream) {
    addLog('🎧 Starting multistream audio capture...', 'info');
    
    // Log stream details
    const tracks = audioStream.getTracks();
    addLog(`🎵 Multistream audio stream has ${tracks.length} audio track(s)`, 'info');
    
    tracks.forEach((track, index) => {
        addLog(`🔊 Audio track ${index}: ${track.id}, enabled: ${track.enabled}`, 'info');
        const settings = track.getSettings();
        addLog(`🔊 Track settings: ${JSON.stringify(settings)}`, 'info');
    });
    
    try {
        // Create audio processor instance using shared component
        audioProcessor = new AudioProcessor(meetingId, hostEmail, backendClient);
        
        // Start processing using shared audio processor (same as legacy renderer)
        await audioProcessor.startProcessing(audioStream);
        
        addLog('✅ Multistream audio capture started successfully', 'success');
        
    } catch (error) {
        addLog(`❌ Failed to start multistream audio capture: ${error.message}`, 'error');
        throw error;
    }
}

// ============================================================================
// SPEAKER CHANGE HANDLING (with 3-second debouncing)
// ============================================================================

// Debouncing configuration
const SPEAKER_CONFIG = {
    debounceThreshold: 3000,      // 3 seconds - how long speaker must be stable before saving
    silenceThreshold: 1000,        // 0.5 seconds - how long silence before clearing current speaker
    enableDebouncing: true        // Toggle debouncing on/off
};

// Debouncing variables
let currentSpeakerId = null;
let speakerStartTime = null;
let speakerDebounceTimer = null;
let silenceTimer = null;

async function handleSpeakerChange(memberIds) {
    const detectedSpeakerId = (memberIds && memberIds.length > 0) ? memberIds[0] : null;
    
    // Clear any existing silence timer since we got an event
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    if (!detectedSpeakerId) {
        addLog('🔇 No active speakers detected', 'info');
        
        // Start silence timer - only clear current speaker after silence threshold
        if (currentSpeakerId) {
            silenceTimer = setTimeout(() => {
                addLog(`🤫 Silence threshold reached (${SPEAKER_CONFIG.silenceThreshold}ms), clearing current speaker`, 'info');
                clearTimeout(speakerDebounceTimer);
                currentSpeakerId = null;
                speakerStartTime = null;
                speakerDebounceTimer = null;
            }, SPEAKER_CONFIG.silenceThreshold);
        }
        return;
    }
    
    // Check if debouncing is disabled - save immediately
    if (!SPEAKER_CONFIG.enableDebouncing) {
        await processSpeakerEventImmediate(detectedSpeakerId);
        return;
    }
    
    // Check if this is the same speaker as before
    if (detectedSpeakerId === currentSpeakerId) {
        // Same speaker, no action needed (timer already running)
        return;
    }
    
    // New speaker detected
    addLog(`🗣️ Speaker change detected: ${detectedSpeakerId}`, 'info');
    
    // Clear any existing debounce timer
    if (speakerDebounceTimer) {
        clearTimeout(speakerDebounceTimer);
    }
    
    // Update current speaker and start time
    currentSpeakerId = detectedSpeakerId;
    speakerStartTime = new Date();
    
    // Start configurable debounce timer
    speakerDebounceTimer = setTimeout(async () => {
        await processSpeakerEvent(currentSpeakerId, speakerStartTime);
    }, SPEAKER_CONFIG.debounceThreshold);
    
    addLog(`⏱️ Debounce timer started: ${SPEAKER_CONFIG.debounceThreshold}ms for ${detectedSpeakerId}`, 'info');
}

async function processSpeakerEvent(speakerId, startTime) {
    addLog(`✅ Speaker confirmed after ${SPEAKER_CONFIG.debounceThreshold}ms: ${speakerId}`, 'success');
    
    try {
        // Get member name if available
        let memberName = null;
        try {
            if (currentMeeting && currentMeeting.members) {
                const member = currentMeeting.members.membersCollection.get(speakerId);
                if (member) {
                    memberName = member.name || member.displayName;
                }
            }
        } catch (error) {
            addLog(`⚠️ Could not get member name: ${error.message}`, 'warn');
        }
        
        // Send speaker event to backend with DateTime format
        await saveSpeakerEvent({
            meeting_id: meetingId,
            member_id: speakerId,
            member_name: memberName,
            speaker_started_at: startTime.toISOString() // Convert to ISO string for API
        });
        
        addLog(`✅ Speaker event saved: ${memberName || speakerId} at ${startTime.toISOString()}`, 'success');
        
    } catch (error) {
        addLog(`❌ Failed to save speaker event: ${error.message}`, 'error');
    }
}

async function processSpeakerEventImmediate(speakerId) {
    addLog(`🚀 Immediate speaker event (debouncing disabled): ${speakerId}`, 'info');
    
    try {
        // Get member name if available
        let memberName = null;
        try {
            if (currentMeeting && currentMeeting.members) {
                const member = currentMeeting.members.membersCollection.get(speakerId);
                if (member) {
                    memberName = member.name || member.displayName;
                }
            }
        } catch (error) {
            addLog(`⚠️ Could not get member name: ${error.message}`, 'warn');
        }
        
        // Send speaker event to backend immediately
        await saveSpeakerEvent({
            meeting_id: meetingId,
            member_id: speakerId,
            member_name: memberName,
            speaker_started_at: new Date().toISOString()
        });
        
        addLog(`✅ Immediate speaker event saved: ${memberName || speakerId}`, 'success');
        
    } catch (error) {
        addLog(`❌ Failed to save immediate speaker event: ${error.message}`, 'error');
    }
}

async function saveSpeakerEvent(eventData) {
    try {
        // Add new method to BackendClient for speaker events
        const response = await backendClient.sendSpeakerEvent(eventData);
        return response;
    } catch (error) {
        addLog(`❌ Error sending speaker event: ${error.message}`, 'error');
        throw error;
    }
}

// ============================================================================
// MEDIA CLEANUP (Same as original)
// ============================================================================

function handleMediaCleanup() {
    addLog('🛑 Remote audio stopped, cleaning up...', 'info');
    
    // Clean up multistream audio element
    const audioElement = document.getElementById('multistream-remote-audio');
    if (audioElement) {
        audioElement.srcObject = null;
        audioElement.remove();
        addLog('✅ Multistream audio element cleared', 'success');
    }
    
    // Clean up audio context
    if (meetingAudioContext) {
        meetingAudioContext.close();
        meetingAudioContext = null;
        addLog('✅ Meeting audio context cleaned up', 'success');
    }
}

// ============================================================================
// MEETING LIFECYCLE (Same as original)
// ============================================================================

async function handleMeetingEnd(eventType) {
    addLog(`🔚 Meeting ended (${eventType}) - Closing app to prevent hanging browser in GCP`, 'warn');
    
    // Stop audio processing
    if (audioProcessor) {
        audioProcessor.stop();
        audioProcessor = null;
        addLog('✅ Audio processing stopped', 'success');
    }
    
    // Close Electron app immediately (critical for GCP deployment)
    addLog('👋 Closing Electron app now...', 'info');
    const { remote } = window.require('electron');
    if (remote && remote.app) {
        remote.app.quit();
    } else {
        // Fallback: close window
        window.close();
    }
}

async function leaveMeeting() {
    try {
        addLog('👋 Leaving multistream meeting...', 'info');
        showStatus('Leaving meeting...', 'info');
        
        if (currentMeeting) {
            await currentMeeting.leave();
            addLog('✅ Meeting left successfully', 'success');
        }
        
        // Close app immediately after leaving
        handleMeetingEnd('manual-leave');
        
    } catch (error) {
        addLog(`❌ Error leaving meeting: ${error.message}`, 'error');
        // Force cleanup and app closure even if leave fails
        handleMeetingEnd('leave-error');
    }
}

// ============================================================================
// UTILITY FUNCTIONS (Same as original)
// ============================================================================

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
