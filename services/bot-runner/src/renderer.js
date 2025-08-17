// Import Webex SDK and initialize bot
const { WebexMeetingBot } = require('./webex/meeting');

// Global variables
let webexBot = null;
let isInitialized = false;

// Logging functions
function addLog(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${timestamp}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function updateStatus(status, isConnected = false, isConnecting = false) {
    const statusElement = document.getElementById('status');
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
    
    joinBtn.disabled = inMeeting;
    leaveBtn.disabled = !inMeeting;
}

// Initialize the bot
async function initializeBot() {
    try {
        addLog('Initializing Webex Meeting Bot...');
        updateStatus('Initializing...', false, true);
        
        webexBot = new WebexMeetingBot();
        await webexBot.initialize();
        
        isInitialized = true;
        updateStatus('Ready - Not in meeting');
        addLog('Bot initialized successfully', 'info');
        
        // Expose bot to global scope for IPC calls
        window.webexBot = {
            joinMeeting: joinMeetingHandler,
            leaveMeeting: leaveMeetingHandler,
            getMeetingStatus: getMeetingStatusHandler
        };
        
    } catch (error) {
        addLog(`Failed to initialize bot: ${error.message}`, 'error');
        updateStatus('Initialization Failed');
        console.error('Bot initialization error:', error);
    }
}

// Meeting control handlers
async function joinMeetingHandler(meetingLink, hostEmail) {
    try {
        if (!isInitialized) {
            throw new Error('Bot not initialized');
        }
        
        addLog(`Joining meeting: ${meetingLink}`);
        updateStatus('Joining meeting...', false, true);
        
        const result = await webexBot.joinMeeting(meetingLink, hostEmail);
        
        updateStatus('In meeting', true);
        updateButtons(true);
        addLog(`Successfully joined meeting: ${result.backendMeetingId}`, 'info');
        
        return result;
        
    } catch (error) {
        addLog(`Failed to join meeting: ${error.message}`, 'error');
        updateStatus('Join failed');
        updateButtons(false);
        throw error;
    }
}

async function leaveMeetingHandler() {
    try {
        if (!isInitialized) {
            throw new Error('Bot not initialized');
        }
        
        addLog('Leaving meeting...');
        updateStatus('Leaving meeting...', false, true);
        
        await webexBot.leaveMeeting();
        
        updateStatus('Ready - Not in meeting');
        updateButtons(false);
        addLog('Successfully left meeting', 'info');
        
        return { success: true };
        
    } catch (error) {
        addLog(`Failed to leave meeting: ${error.message}`, 'error');
        updateStatus('Leave failed');
        throw error;
    }
}

async function getMeetingStatusHandler() {
    try {
        if (!isInitialized) {
            throw new Error('Bot not initialized');
        }
        
        const status = webexBot.getMeetingStatus();
        addLog(`Meeting status: ${JSON.stringify(status)}`);
        
        return status;
        
    } catch (error) {
        addLog(`Failed to get status: ${error.message}`, 'error');
        throw error;
    }
}

// UI control functions
async function joinMeeting() {
    const meetingLink = document.getElementById('meetingLink').value.trim();
    const hostEmail = document.getElementById('hostEmail').value.trim();
    
    if (!meetingLink) {
        addLog('Please enter a meeting link or ID', 'warn');
        return;
    }
    
    try {
        await joinMeetingHandler(meetingLink, hostEmail || null);
    } catch (error) {
        // Error already logged in handler
    }
}

async function leaveMeeting() {
    try {
        await leaveMeetingHandler();
    } catch (error) {
        // Error already logged in handler
    }
}

async function getStatus() {
    try {
        await getMeetingStatusHandler();
    } catch (error) {
        // Error already logged in handler
    }
}

// Set up event listeners for Electron IPC
if (window.electronAPI) {
    window.electronAPI.onMeetingJoined((event, data) => {
        addLog(`Meeting joined event: ${JSON.stringify(data)}`);
    });
    
    window.electronAPI.onMeetingLeft((event, data) => {
        addLog(`Meeting left event: ${JSON.stringify(data)}`);
    });
    
    window.electronAPI.onMeetingError((event, error) => {
        addLog(`Meeting error: ${error}`, 'error');
    });
    
    window.electronAPI.onAudioChunkProcessed((event, data) => {
        addLog(`Audio chunk processed: ${data.chunkNumber}`);
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    addLog('Page loaded, starting initialization...');
    initializeBot();
});

// Handle page unload
window.addEventListener('beforeunload', async (event) => {
    if (webexBot && webexBot.isInMeeting) {
        addLog('Page unloading, leaving meeting...');
        try {
            await webexBot.leaveMeeting();
        } catch (error) {
            console.error('Error leaving meeting on unload:', error);
        }
    }
});
