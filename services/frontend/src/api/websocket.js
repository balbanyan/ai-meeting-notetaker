// Simple WebSocket client for meeting status updates
// Connects to /ws/meeting-status/{meetingId} endpoint

const getWebSocketUrl = (path) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}${path}`
}

/**
 * Connect to meeting status WebSocket
 * @param {string} meetingId - Webex meeting ID (original_webex_meeting_id)
 * @param {function} onStatusChange - Callback when status changes: (isActive) => void
 * @returns {object} WebSocket controller with disconnect method
 */
export function connectToMeetingStatus(meetingId, onStatusChange) {
  let ws = null
  let pingInterval = null
  let reconnectTimeout = null
  let isManualClose = false
  
  const connect = () => {
    const url = getWebSocketUrl(`/ws/meeting-status/${meetingId}`)
    console.log(`🔌 Connecting to meeting status WebSocket: ${url}`)
    
    ws = new WebSocket(url)
    
    ws.onopen = () => {
      console.log(`✅ Meeting status WebSocket connected for ${meetingId}`)
      
      // Ping every 30 seconds to keep connection alive
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send('ping')
        }
      }, 30000)
    }
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        console.log('📩 WebSocket message:', message.type)
        
        if (message.type === 'status' && message.data) {
          onStatusChange(message.data.is_active)
        }
        // Ignore pong messages
      } catch (e) {
        console.error('WebSocket message parse error:', e)
      }
    }
    
    ws.onclose = (event) => {
      console.log(`🔌 WebSocket closed for ${meetingId}:`, event.code, event.reason)
      
      // Clear ping interval
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }
      
      // Reconnect after 5 seconds if not manually closed
      if (!isManualClose) {
        console.log(`🔄 Reconnecting in 5 seconds...`)
        reconnectTimeout = setTimeout(connect, 5000)
      }
    }
    
    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error)
    }
  }
  
  // Initial connection
  connect()
  
  // Return controller object
  return {
    disconnect: () => {
      console.log(`🔌 Disconnecting WebSocket for ${meetingId}`)
      isManualClose = true
      
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }
      
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }
      
      if (ws) {
        ws.close()
        ws = null
      }
    }
  }
}

export default { connectToMeetingStatus }
