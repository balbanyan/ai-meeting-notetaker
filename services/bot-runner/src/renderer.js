// Webex Meeting Bot Renderer Process
// Following official documentation: https://developer.webex.com/blog/how-to-build-meeting-bots-for-webex

// Global variables
let webex = null;
let currentMeeting = null;
let isInitialized = false;
let config = null;

// Import configuration using require (works in Electron renderer with nodeIntegration)
try {
    const configModule = require('./utils/config');
    config = configModule.config;
    console.log('✅ Configuration loaded successfully');
} catch (error) {
    console.error('❌ Failed to load configuration:', error);
}

// Logging functions
function addLog(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    if (!logContainer) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function updateStatus(status, isConnected = false, isConnecting = false) {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;
    
    statusElement.textContent = `Status: ${status}`;
    
    if (isConnecting) {
        statusElement.className = 'status connecting';
    } else if (isConnected) {
        statusElement.className = 'status connected';
    } else {
        statusElement.className = 'status disconnected';
    }
}

function updateButtons(inMeeting = false) {
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    
    if (joinBtn) joinBtn.disabled = inMeeting;
    if (leaveBtn) leaveBtn.disabled = !inMeeting;
}

// Build JWT following official documentation
function buildJwt() {
    if (!config) {
        throw new Error('Configuration not loaded');
    }
    
    try {
        addLog('Building JWT token...');
        
        // Use crypto-js as specified in official docs
        const CryptoJS = require('crypto-js');
        
        const payload = {
            sub: config.bot.email, // Use bot email as subject
            name: config.bot.displayName, // Use bot display name
            iss: config.webex.guestIssuerId, // Guest Issuer ID
            exp: Math.floor(new Date().getTime() / 1000) + 60 * 60 // 1h expiry (as number)
        };
        
        addLog(`JWT payload: ${JSON.stringify(payload, null, 2)}`);
        
        const header = {
            typ: "JWT",
            alg: "HS256"
        };
        
        // Encode header and payload using Base64url as per docs
        const encodedHeader = CryptoJS.enc.Base64url.stringify(
            CryptoJS.enc.Utf8.parse(JSON.stringify(header))
        );
        const encodedPayload = CryptoJS.enc.Base64url.stringify(
            CryptoJS.enc.Utf8.parse(JSON.stringify(payload))
        );
        
        const encodedData = `${encodedHeader}.${encodedPayload}`;
        
        // Create signature using Guest Issuer Secret
        const signature = CryptoJS.HmacSHA256(
            encodedData,
            CryptoJS.enc.Base64.parse(config.webex.guestIssuerSecret)
        ).toString(CryptoJS.enc.Base64url);
        
        const jwt = `${encodedData}.${signature}`;
        
        addLog(`✅ JWT generated successfully (${jwt.length} chars)`);
        return jwt;
        
    } catch (error) {
        addLog(`❌ JWT generation failed: ${error.message}`, 'error');
        throw error;
    }
}

// Initialize Webex SDK following official documentation
async function initializeWebexSDK() {
    try {
        addLog('🚀 Initializing Webex SDK...');
        
        // Import and initialize Webex SDK (following official docs)
        // Note: In Electron, we use window.Webex instead of import
        if (!window.Webex) {
            throw new Error('Webex SDK not loaded. Make sure to include it in HTML.');
        }
        
        addLog('Creating Webex instance...');
        webex = window.Webex.init();
        
        if (!webex) {
            throw new Error('Failed to initialize Webex SDK');
        }
        
        addLog('✅ Webex SDK instance created');
        
        // Build JWT and authorize following official docs
        addLog('Generating JWT for authentication...');
        const jwt = buildJwt();
        
        addLog('Requesting access token from JWT...');
        await webex.authorization.requestAccessTokenFromJwt({ jwt });
        
        addLog('✅ Webex SDK authentication successful!');
        
        // Verify we have access to meetings
        if (!webex.meetings) {
            throw new Error('Webex meetings namespace not available');
        }
        
        addLog('✅ Webex meetings namespace available');
        
        isInitialized = true;
        updateStatus('Ready - Not in meeting');
        addLog('🎉 Webex SDK initialization complete!', 'info');
        
        return webex;
        
    } catch (error) {
        isInitialized = false;
        webex = null;
        addLog(`❌ Webex SDK initialization failed: ${error.message}`, 'error');
        updateStatus('Initialization Failed');
        
        // Provide specific guidance based on error type
        if (error.message.includes('JWT') || error.message.includes('Guest Issuer')) {
            addLog('💡 Check Guest Issuer credentials in .env file', 'warn');
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            addLog('💡 Check internet connection and firewall settings', 'warn');
        } else if (error.message.includes('Webex SDK not loaded')) {
            addLog('💡 Webex SDK script needs to be loaded in HTML', 'warn');
        }
        
        throw error;
    }
}

// Join meeting following official documentation
async function joinMeeting(meetingLinkOrId, hostEmail = null) {
    try {
        if (!isInitialized || !webex) {
            throw new Error('Webex SDK not initialized');
        }
        
        addLog(`🎯 Starting to join meeting: ${meetingLinkOrId}`);
        updateStatus('Joining meeting...', false, true);
        
        // Create meeting object following official docs
        addLog('Creating meeting object...');
        const meeting = await webex.meetings.create(meetingLinkOrId);
        
        if (!meeting) {
            throw new Error('Failed to create meeting object');
        }
        
        addLog('✅ Meeting object created successfully');
        currentMeeting = meeting;
        
        // Set up event listeners following official docs
        addLog('Setting up meeting event listeners...');
        
        // Listen for successful join (self:unlocked event)
        meeting.on("self:unlocked", () => {
            addLog('🎉 Successfully joined meeting (self:unlocked)', 'info');
            updateStatus('In meeting', true);
            updateButtons(true);
        });
        
        // Listen for media streams (following official docs)
        meeting.on("media:ready", ({ type, stream }) => {
            addLog(`📺 Media ready: ${type}`, 'info');
            // Here we would process the media stream
            // type can be 'remoteAudio' | 'remoteVideo' | 'remoteShare'
        });
        
        // Listen for other important events
        meeting.on("meeting:left", () => {
            addLog('Meeting left', 'info');
            updateStatus('Ready - Not in meeting');
            updateButtons(false);
            currentMeeting = null;
        });
        
        meeting.on("error", (error) => {
            addLog(`Meeting error: ${error.message}`, 'error');
        });
        
        addLog('Event listeners set up successfully');
        
        // Trigger join following official docs
        addLog('Triggering meeting join...');
        await meeting.join();
        
        addLog('✅ Meeting join request sent successfully');
        return { success: true, meetingId: meeting.id };
        
    } catch (error) {
        addLog(`❌ Failed to join meeting: ${error.message}`, 'error');
        updateStatus('Join failed');
        updateButtons(false);
        throw error;
    }
}

// Leave meeting following official documentation
async function leaveMeeting() {
    try {
        if (!currentMeeting) {
            throw new Error('No active meeting to leave');
        }
        
        addLog('🚪 Leaving meeting...');
        updateStatus('Leaving meeting...', false, true);
        
        // Leave meeting following official docs
        await currentMeeting.leave();
        
        addLog('✅ Successfully left meeting', 'info');
        updateStatus('Ready - Not in meeting');
        updateButtons(false);
        currentMeeting = null;
        
        return { success: true };
        
    } catch (error) {
        addLog(`❌ Failed to leave meeting: ${error.message}`, 'error');
        updateStatus('Leave failed');
        throw error;
    }
}

// Get meeting status
function getMeetingStatus() {
    try {
        const status = {
            isInitialized: isInitialized,
            hasWebex: !!webex,
            hasCurrentMeeting: !!currentMeeting,
            timestamp: new Date().toISOString()
        };
        
        if (currentMeeting) {
            status.meetingId = currentMeeting.id;
            status.meetingState = currentMeeting.state;
        }
        
        addLog(`Meeting status: ${JSON.stringify(status, null, 2)}`);
        return status;
        
    } catch (error) {
        const errorStatus = {
            error: error.message,
            isInitialized: isInitialized,
            hasWebex: !!webex,
            timestamp: new Date().toISOString()
        };
        
        addLog(`Status error: ${error.message}`, 'error');
        return errorStatus;
    }
}

// UI control functions
async function joinMeetingUI() {
    const meetingLink = document.getElementById('meetingLink')?.value?.trim();
    const hostEmail = document.getElementById('hostEmail')?.value?.trim();
    
    if (!meetingLink) {
        addLog('Please enter a meeting link or ID', 'warn');
        return;
    }
    
    try {
        await joinMeeting(meetingLink, hostEmail || null);
    } catch (error) {
        // Error already logged in joinMeeting function
    }
}

async function leaveMeetingUI() {
    try {
        await leaveMeeting();
    } catch (error) {
        // Error already logged in leaveMeeting function
    }
}

function getStatusUI() {
    try {
        return getMeetingStatus();
    } catch (error) {
        // Error already logged in getMeetingStatus function
    }
}

// Test initialization manually
async function testInitialization() {
    addLog('🧪 Manual initialization test started...');
    
    try {
        // Reset state
        isInitialized = false;
        webex = null;
        currentMeeting = null;
        
        // Clear logs
        const logContainer = document.getElementById('logContainer');
        if (logContainer) logContainer.innerHTML = '';
        
        // Run initialization
        await initializeWebexSDK();
        
        if (isInitialized && webex) {
            addLog('✅ Manual test PASSED - Bot is initialized and ready!', 'info');
        } else {
            addLog('❌ Manual test FAILED - Bot not properly initialized', 'error');
        }
        
    } catch (error) {
        addLog(`💥 Manual test ERROR: ${error.message}`, 'error');
    }
}

// Make functions available globally for HTML onclick handlers
window.joinMeeting = joinMeetingUI;
window.leaveMeeting = leaveMeetingUI;
window.getStatus = getStatusUI;
window.testInitialization = testInitialization;

// Expose bot API for IPC calls
window.webexBot = {
    joinMeeting: joinMeeting,
    leaveMeeting: leaveMeeting,
    getMeetingStatus: getMeetingStatus,
    isInitialized: () => isInitialized,
    getWebex: () => webex
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    addLog('📄 Page loaded, starting initialization...');
    initializeWebexSDK().catch(error => {
        addLog(`Initialization failed on page load: ${error.message}`, 'error');
    });
});

// Handle page unload
window.addEventListener('beforeunload', async (event) => {
    if (currentMeeting) {
        addLog('Page unloading, leaving meeting...');
        try {
            await leaveMeeting();
        } catch (error) {
            console.error('Error leaving meeting on unload:', error);
        }
    }
});